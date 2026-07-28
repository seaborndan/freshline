using Microsoft.AspNetCore.HttpOverrides;

namespace Freshline.Api.Hosting;

/// <summary>
/// How many reverse proxies stand between the internet and this process.
/// </summary>
public sealed class IngressSettings
{
    public const string SectionName = "Ingress";

    /// <summary>
    /// The number of proxies in front of this app. <strong>Zero by default, which means trust
    /// nothing.</strong>
    ///
    /// <para>Defaulting to zero is the whole safety property. Running locally there is no proxy, so
    /// any caller could send <c>X-Forwarded-For</c> and be believed — which would let anyone mint a
    /// fresh rate-limit bucket per request, turning the limiter off for precisely the caller it
    /// exists to stop. A deployment that genuinely has a proxy says so explicitly.</para>
    ///
    /// <para>One, in the deployment this milestone builds: Azure Container Apps puts a single Envoy
    /// ingress in front of the container and nothing else.</para>
    /// </summary>
    public int ProxyHopCount { get; set; }
}

/// <summary>
/// Recovering the real client address from behind a proxy, which the rate limiter depends on.
///
/// <para><strong>The problem, restated from ADR-0005.</strong> The limiter partitions on
/// <c>RemoteIpAddress</c>. Behind any ingress that is the proxy's address, so every caller collapses
/// into one bucket and a per-client limit becomes a global one that locks everybody out together.
/// The fix is to read <c>X-Forwarded-For</c> — but that header is caller-supplied, and believing it
/// unconditionally is worse than ignoring it, because anyone can then put a fresh value in it on
/// every request.</para>
///
/// <para><strong>Why this does not populate <c>KnownProxies</c>, which is the usual answer.</strong>
/// It cannot. On the Container Apps consumption profile the ingress addresses are managed by the
/// platform, are not published, and change without notice. An IP list here would be a list of
/// guesses that fails closed one day without warning.</para>
///
/// <para><strong>What bounds the trust instead.</strong> <c>X-Forwarded-For</c> is a list and each
/// proxy <em>appends</em> to it. ASP.NET Core's middleware reads that list
/// <a href="https://learn.microsoft.com/aspnet/core/host-and-deploy/proxy-load-balancer">right to
/// left</a> and <c>ForwardLimit</c> caps how many entries it will walk. With a limit of one, only the
/// rightmost entry is read — the one the ingress itself appended. A caller who sends
/// <c>X-Forwarded-For: 1.2.3.4</c> produces <c>1.2.3.4, their-real-address</c> by the time it
/// arrives here, and the forged value is never reached.</para>
///
/// <para><strong>The residual risk, stated rather than glossed.</strong> Microsoft's own
/// documentation calls <c>ForwardLimit</c> "a precaution, but not a guarantee". Clearing
/// <c>KnownProxies</c> removes the check that the connection came from a trusted address, so the
/// remaining assumption is that nothing can reach this container except through the ingress. On
/// Container Apps with external ingress that holds — the container's port is not routable from the
/// internet — and it is an assumption about network topology rather than about caller behaviour,
/// which is the right kind to be left with. It is also verifiable: send a request with a forged
/// header at the deployed URL and confirm the limiter still counts against the real address.</para>
/// </summary>
public static class IngressConfiguration
{
    public static IServiceCollection AddFreshlineForwardedHeaders(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        IngressSettings settings = configuration.GetSection(IngressSettings.SectionName)
            .Get<IngressSettings>() ?? new IngressSettings();

        services.Configure<ForwardedHeadersOptions>(options =>
        {
            // XForwardedProto as well as XForwardedFor: the ingress terminates TLS, so without it
            // every request looks like plain HTTP to this process and UseHttpsRedirection would
            // redirect a request that already arrived over HTTPS — a loop.
            options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;

            // Exactly as many entries as there are proxies. See the note above: this is what stops a
            // forged leading entry from ever being read.
            options.ForwardLimit = settings.ProxyHopCount;

            // Deliberately empty. The addresses cannot be known on this platform, and an empty list
            // means the middleware does not require the connection to come from a listed proxy.
            options.KnownProxies.Clear();
            options.KnownNetworks.Clear();
        });

        return services;
    }

    /// <summary>
    /// Adds the middleware only when a proxy is declared.
    ///
    /// <para>Not registering it at all is stronger than registering it with a limit of zero: there is
    /// no configuration mistake that can turn it on by accident, and locally the header is not read
    /// under any circumstances.</para>
    /// </summary>
    public static IApplicationBuilder UseFreshlineForwardedHeaders(
        this IApplicationBuilder app,
        IConfiguration configuration)
    {
        IngressSettings settings = configuration.GetSection(IngressSettings.SectionName)
            .Get<IngressSettings>() ?? new IngressSettings();

        if (settings.ProxyHopCount < 1)
        {
            return app;
        }

        return app.UseForwardedHeaders();
    }
}
