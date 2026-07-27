using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Freshline.Api.Authentication;

/// <summary>
/// What this API needs in order to check a token somebody else issued.
/// </summary>
public sealed class JwtOptions
{
    public const string SectionName = "Jwt";

    /// <summary>The configuration key of <see cref="PublicKeyPem"/>, for error messages that have to
    /// tell an operator which setting to go and look at.</summary>
    public const string PublicKeyPemName = $"{SectionName}:{nameof(PublicKeyPem)}";

    /// <summary>
    /// Who is allowed to have issued the token. Checked, not decorative — an unchecked issuer means
    /// a validly signed token from an unrelated system is accepted here.
    /// </summary>
    [Required]
    public string Issuer { get; set; } = "https://freshline.local";

    /// <summary>
    /// Who the token was meant for. Checked for the same reason: without it, a token this issuer
    /// minted for a different service is accepted by this one.
    /// </summary>
    [Required]
    public string Audience { get; set; } = "freshline-api";

    /// <summary>
    /// The issuer's RSA <strong>public</strong> key, PEM-encoded (<c>-----BEGIN PUBLIC KEY-----</c>).
    ///
    /// <para>Null means no key is configured, which is a supported state rather than a broken one —
    /// see <see cref="AddFreshlineJwtAuthentication"/>. The read endpoints are anonymous, so the API
    /// serves its entire public purpose without one.</para>
    ///
    /// <para><strong>This is not a secret and does not belong in Key Vault.</strong> It is a public
    /// key; publishing it is what public keys are for. That is a consequence of the asymmetric
    /// choice rather than a coincidence — see the class remarks.</para>
    /// </summary>
    public string? PublicKeyPem { get; set; }
}

/// <summary>
/// Bearer token validation.
///
/// <para><strong>The decision that shapes the rest of this file: the key is asymmetric.</strong> The
/// milestone states that this API validates tokens and does not issue them. A shared symmetric secret
/// would contradict that in the only way that matters — with an HMAC key, the power to verify a
/// signature <em>is</em> the power to forge one, so every service holding it is an issuer whether it
/// intends to be or not. With RSA the API holds the public half: it can check a signature and cannot
/// produce one. The stated split becomes a property of the cryptography rather than a promise about
/// how the key is used.</para>
///
/// <para>It also settles a security rule cleanly. CLAUDE.md forbids secrets in the repository and
/// routes real ones through Key Vault; a public key is not a secret, so this API's auth
/// configuration contains nothing confidential at all. Nothing to leak is a stronger position than
/// something well guarded.</para>
///
/// <para><strong>What is deliberately not built.</strong> There is no login, no signup, no token
/// endpoint, no user store and no password handling. Issuance is M6's problem and has its own
/// storage, rotation and revocation story. Tests mint tokens with a test key, which is exactly what
/// a separate issuer will do in production.</para>
///
/// <para><strong>Revocation does not exist</strong>, and stateless bearer tokens are why: nothing
/// here can invalidate a token before it expires, because nothing here is consulted. Short lifetimes
/// are the mitigation and they are the issuer's setting, not this API's. Worth knowing before anyone
/// builds a "sign out everywhere" button on top of this.</para>
/// </summary>
internal static class JwtAuthentication
{
    public static IServiceCollection AddFreshlineJwtAuthentication(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        services
            .AddOptions<JwtOptions>()
            .Bind(configuration.GetSection(JwtOptions.SectionName))
            .ValidateDataAnnotations()
            .ValidateOnStart();

        JwtOptions settings = new();
        configuration.GetSection(JwtOptions.SectionName).Bind(settings);

        RsaSecurityKey? signingKey = ReadPublicKey(settings.PublicKeyPem);

        services
            .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(bearer =>
            {
                // RequireHttpsMetadata is deliberately not set here. It governs fetching an
                // authority's discovery document over HTTPS, and this handler has no Authority — the
                // key is configured directly — so setting it would be a line that reads like a
                // transport-security control and enforces nothing. Transport security comes from
                // UseHttpsRedirection in the pipeline, which is where it actually lives. When M6
                // moves to a real issuer with JWKS discovery, this becomes a genuine setting and
                // must be turned on.

                // Stops the legacy WS-Federation claim mapping that silently rewrites "sub" to
                // http://schemas.xmlsoap.org/.../nameidentifier. Left on, code that reads "sub"
                // finds nothing and the natural fix is to hard-code the long URI — which then breaks
                // if the mapping is ever turned off. The claims stay as the token spelled them.
                bearer.MapInboundClaims = false;

                bearer.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidIssuer = settings.Issuer,

                    ValidateAudience = true,
                    ValidAudience = settings.Audience,

                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = signingKey,

                    // An unsigned token is not a token. This is the "alg: none" defence, and it is
                    // set explicitly rather than left to a default, because a default that changes
                    // is not a defence.
                    RequireSignedTokens = true,

                    ValidateLifetime = true,
                    RequireExpirationTime = true,

                    // The default is five minutes, which quietly extends every token's life by that
                    // much on both ends. Thirty seconds is enough for ordinary clock drift between
                    // an issuer and this API and does not turn a 60-second token into a 6-minute one.
                    ClockSkew = TimeSpan.FromSeconds(30),

                    // Accept exactly one signing algorithm. Two barriers stand between this API and
                    // an algorithm-confusion forgery, and it is worth being precise about which does
                    // what, because the tempting summary is wrong.
                    //
                    // The attack: take the RSA public key — published, so the attacker has it — and
                    // use its bytes as the shared secret of an HS256 token. A validator that will
                    // use whatever key material it holds under whatever algorithm the token asks for
                    // then verifies a signature made with a key it handed out itself.
                    //
                    // What actually stops that here is the key set: IssuerSigningKey is an
                    // RsaSecurityKey, which cannot serve as an HMAC key, so no key resolves for
                    // HS256 and the token is refused. That was verified rather than assumed — the
                    // test minting exactly this token still passes with the line below deleted.
                    //
                    // This line is therefore the second barrier, not the first, and its own effect
                    // is narrower: it refuses any algorithm other than RS256 even when a key for one
                    // is available. Today that means an RS512 token signed by the correct private
                    // key is rejected — which is what RefusesATokenSignedWithAnUnpinnedAlgorithm
                    // proves, and that test does fail without this line. It matters more later than
                    // now: the moment the key set gains a symmetric key, for a second issuer or via
                    // JWKS, the first barrier is gone and this becomes the only one.
                    ValidAlgorithms = [SecurityAlgorithms.RsaSha256],

                    // Read "sub" and "role" the way the tokens actually spell them, rather than the
                    // WS-Federation URIs ClaimsIdentity defaults to. With MapInboundClaims off, the
                    // defaults would leave User.Identity.Name and role checks looking at claim types
                    // no token in this system contains.
                    NameClaimType = JwtRegisteredClaimNames.Sub,
                    RoleClaimType = "role",
                };
            });

        services.AddAuthorization();

        return services;
    }

    /// <summary>
    /// Turns the configured PEM into a key, or returns null when none is configured.
    ///
    /// <para><strong>Why an unconfigured key is allowed to start.</strong> Refusing to start would be
    /// the reflex, and it would be wrong here. Every read endpoint in this API is anonymous by
    /// design, and this milestone is done when a stranger can explore a working map — so demanding an
    /// RSA keypair before the public map will serve a request would make the deliverable depend on a
    /// credential the deliverable does not use. With no key, the scheme is still registered and every
    /// token fails validation, so an authenticated endpoint answers 401. That is the correct answer
    /// to "prove who you are" from an API that cannot check.</para>
    ///
    /// <para>A malformed key is the opposite case and does throw. Configuring a key is a statement
    /// that this deployment intends to accept tokens; failing that quietly would leave an API that
    /// looks authenticated and rejects everyone, discovered by a user rather than by startup.</para>
    /// </summary>
    private static RsaSecurityKey? ReadPublicKey(string? publicKeyPem)
    {
        if (string.IsNullOrWhiteSpace(publicKeyPem))
        {
            return null;
        }

        RSA rsa = RSA.Create();

        try
        {
            rsa.ImportFromPem(publicKeyPem);
        }
        catch (Exception exception)
        {
            rsa.Dispose();

            throw new InvalidOperationException(
                $"'{JwtOptions.PublicKeyPemName}' is not a readable PEM key. " +
                "It must be the issuer's RSA public key, beginning with " +
                "'-----BEGIN PUBLIC KEY-----'. A private key here would be a configuration error " +
                "and a serious one: this API validates tokens and must not be able to mint them.",
                exception);
        }

        return new RsaSecurityKey(rsa);
    }
}
