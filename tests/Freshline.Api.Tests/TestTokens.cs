using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Freshline.Api.Tests;

/// <summary>
/// A throwaway RSA keypair and the ability to mint tokens with it.
///
/// <para>This is the test's half of the split the milestone describes: the API validates tokens and
/// does not issue them, so something else has to. In production that is a separate issuer with its
/// own storage and rotation story; here it is this class. The API is given only
/// <see cref="PublicKeyPem"/> and never sees <see cref="_privateKey"/>, which is the same asymmetry
/// a real deployment has — and the reason these tests can prove the API cannot forge a token, rather
/// than merely not doing so.</para>
///
/// <para>The keypair is generated per run rather than checked in. A private key in the repository
/// would violate CLAUDE.md's first security rule even as a test fixture, and a committed one is
/// exactly the sort of thing that later gets copied into a deployment because it was already
/// there.</para>
/// </summary>
internal sealed class TestTokens : IDisposable
{
    /// <summary>2048 bits: the smallest size still considered sound for RSA signatures.</summary>
    private readonly RSA _privateKey = RSA.Create(2048);

    public const string Issuer = "https://issuer.test";
    public const string Audience = "freshline-api";

    /// <summary>What the API is configured with. A public key, and so not a secret.</summary>
    public string PublicKeyPem => _privateKey.ExportSubjectPublicKeyInfoPem();

    /// <summary>
    /// A token the API should accept, unless one of the arguments is deliberately wrong. Every
    /// parameter defaults to the valid value so each test varies exactly one thing and the reason it
    /// is rejected is unambiguous.
    /// </summary>
    public string Mint(
        string subject = "user-1",
        string[]? roles = null,
        string issuer = Issuer,
        string audience = Audience,
        TimeSpan? expiresIn = null,
        RSA? signedWith = null)
    {
        Dictionary<string, object> claims = new()
        {
            [JwtRegisteredClaimNames.Sub] = subject,
        };

        if (roles is { Length: > 0 })
        {
            claims["role"] = roles;
        }

        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = issuer,
            Audience = audience,
            Claims = claims,
            Expires = DateTime.UtcNow.Add(expiresIn ?? TimeSpan.FromMinutes(10)),
            SigningCredentials = new SigningCredentials(
                new RsaSecurityKey(signedWith ?? _privateKey),
                SecurityAlgorithms.RsaSha256),
        });
    }

    /// <summary>
    /// The algorithm-confusion attack, minted for real rather than described.
    ///
    /// <para>The API validates with an RSA <em>public</em> key, which is published — the attacker has
    /// it. This takes those published bytes and uses them as the shared secret of an HMAC-signed
    /// token. A validator that accepts whatever algorithm the configured key material can be read as
    /// will then verify a signature made with a key it handed out itself, and the attacker becomes
    /// any user they like.</para>
    ///
    /// <para>What stops it is pinning <c>ValidAlgorithms</c> to RS256, so an HS256 token is rejected
    /// before its signature is examined at all. Remove that pin and this token is accepted.</para>
    /// </summary>
    public string MintWithPublicKeyAsHmacSecret(string subject = "attacker")
        => new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = Audience,
            Claims = new Dictionary<string, object> { [JwtRegisteredClaimNames.Sub] = subject },
            Expires = DateTime.UtcNow.AddMinutes(10),
            SigningCredentials = new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(PublicKeyPem)),
                SecurityAlgorithms.HmacSha256),
        });

    /// <summary>
    /// The right key, the right issuer, the right audience — and RS512 instead of RS256.
    ///
    /// <para>This is what isolates the <c>ValidAlgorithms</c> pin. The public-key-as-HMAC-secret
    /// token in <see cref="MintWithPublicKeyAsHmacSecret"/> is refused whether or not the pin is
    /// present, because an RSA key cannot serve as an HMAC key and none resolves for HS256. This one
    /// has a perfectly good key available for it, so only the pin refuses it — remove that line and
    /// the API accepts this token.</para>
    /// </summary>
    public string MintWithUnpinnedAlgorithm(string subject = "attacker")
        => new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = Audience,
            Claims = new Dictionary<string, object> { [JwtRegisteredClaimNames.Sub] = subject },
            Expires = DateTime.UtcNow.AddMinutes(10),
            SigningCredentials = new SigningCredentials(
                new RsaSecurityKey(_privateKey), SecurityAlgorithms.RsaSha512),
        });

    /// <summary>An unrelated keypair, for proving a valid-looking signature from the wrong signer is
    /// refused.</summary>
    public static RSA SomeoneElsesKey() => RSA.Create(2048);

    public void Dispose() => _privateKey.Dispose();
}
