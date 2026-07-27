using Microsoft.Net.Http.Headers;

namespace Freshline.Api.Cors;

/// <summary>
/// Which browser origins may read this API. Bound from the <c>Cors</c> configuration section.
/// </summary>
public sealed class CrossOriginOptions
{
    public const string SectionName = "Cors";

    /// <summary>
    /// Exact origins, scheme and port included — <c>https://freshline.example</c>, not
    /// <c>freshline.example</c>. Empty means no cross-origin browser access, which is the right
    /// default for an environment nobody has configured.
    /// </summary>
    public string[] AllowedOrigins { get; set; } = [];
}

/// <summary>
/// CORS for the web app, which is a separate origin from the API and will stay one.
/// </summary>
internal static class CrossOriginPolicy
{
    public const string PolicyName = "web";

    /// <summary>
    /// What a developer gets when nothing is configured. Vite's dev server, which is what
    /// <c>npm run dev</c> in <c>web/</c> listens on.
    ///
    /// <para><strong>Why this is in code rather than in appsettings.Development.json.</strong> That
    /// file is in <c>.gitignore</c>, so a value put there would exist on exactly one machine and
    /// every other developer — and CI — would get an API the web app cannot call, with the failure
    /// showing up in the browser console as a CORS error rather than as anything pointing at
    /// configuration. Here it is committed, reviewable, and applies only when
    /// <c>IsDevelopment()</c>, so it cannot follow anything to a deployed environment.</para>
    /// </summary>
    private static readonly string[] DevelopmentOrigins =
    [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ];

    /// <summary>
    /// <strong>Why a configured list rather than <c>AllowAnyOrigin</c>.</strong> There is a real
    /// argument for allowing anything here: the read paths are anonymous, the data is public, and
    /// CORS protects a user's credentials rather than the data itself — with no cookies in play there
    /// is nothing for it to protect. It is rejected for one forward-looking reason. Slice 6 puts an
    /// <c>Authorization</c> header on this API, and a permissive origin list is one
    /// <c>AllowCredentials()</c> away from letting any site on the internet make authenticated calls
    /// with a visitor's session. A list that has to be edited to grow is the version of this that
    /// cannot drift into that by accident.
    ///
    /// <para><strong>Credentials are deliberately not allowed</strong>, and this is not an oversight
    /// to be fixed when auth arrives. Bearer tokens are not cookies: JavaScript attaches them
    /// explicitly, so they cross origins without <c>AllowCredentials()</c>. Turning it on would only
    /// add the ability to send cookies automatically — the exact mechanism that makes a
    /// cross-site request forgery possible — for a capability this API does not use.</para>
    /// </summary>
    public static IServiceCollection AddFreshlineCors(
        this IServiceCollection services,
        IConfiguration configuration,
        IWebHostEnvironment environment)
    {
        CrossOriginOptions settings = new();
        configuration.GetSection(CrossOriginOptions.SectionName).Bind(settings);

        string[] origins = settings.AllowedOrigins.Length == 0 && environment.IsDevelopment()
            ? DevelopmentOrigins
            : settings.AllowedOrigins;

        services.AddCors(cors => cors.AddPolicy(PolicyName, policy =>
        {
            if (origins.Length == 0)
            {
                // An empty policy emits no CORS headers, so a browser refuses to hand the response
                // to the calling script. Nothing is served that would not otherwise be, and no
                // non-browser client is affected — curl and every server-side caller ignore CORS
                // entirely, because it is a rule browsers enforce on themselves.
                return;
            }

            policy
                .WithOrigins(origins)

                // Read-only. Every endpoint in this API is a GET, and a method list that says so is
                // one more thing that has to be deliberately widened before a write path appears.
                .WithMethods(HttpMethods.Get)

                // Authorization for slice 6. Content-Type because a client that sets it on a GET —
                // some do, out of habit — would otherwise fail preflight for no useful reason.
                .WithHeaders(HeaderNames.Authorization, HeaderNames.ContentType)

                // Without this the browser hides Retry-After from the calling script: only a short
                // safelist of response headers is readable cross-origin by default, and Retry-After
                // is not on it. A throttled client would see a 429 and have no idea how long to wait
                // — which makes the most useful half of the rate limiter's answer invisible to the
                // one client type CORS applies to.
                .WithExposedHeaders(HeaderNames.RetryAfter);
        }));

        return services;
    }
}
