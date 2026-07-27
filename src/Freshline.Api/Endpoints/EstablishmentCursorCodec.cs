using System.Buffers.Text;
using System.Text;
using Freshline.Core.Queries;

namespace Freshline.Api.Endpoints;

/// <summary>
/// Turns a cursor into an opaque string for the wire, and back.
///
/// <para><strong>Why this is in the API layer.</strong> The cursor's <em>meaning</em> — a name and an
/// id, the sort key of the last row seen — belongs to the query and lives in Core. How it is spelled
/// in a URL is a transport concern, and this is the transport layer.</para>
///
/// <para><strong>Why it is opaque rather than two query parameters.</strong> Not secrecy: this is
/// trivially decodable and is not a security boundary. It is so that the sort key can change without
/// breaking callers. A client that has learned to send <c>?afterName=X&amp;afterId=7</c> has been
/// handed the ordering as public API, and adding a third sort column then becomes a breaking change.
/// A client that echoes back a string it was given cannot form that dependency.</para>
/// </summary>
internal static class EstablishmentCursorCodec
{
    /// <summary>
    /// The id first, then a colon, then the name.
    ///
    /// <para>The order matters and is not cosmetic. An id is an integer and so cannot contain a
    /// colon, which means splitting on the <em>first</em> colon is unambiguous no matter what the
    /// name contains — and names in this data contain apostrophes, ampersands, quotes and colons.
    /// Putting the name first would need escaping; putting the id first needs none.</para>
    /// </summary>
    private const char Separator = ':';

    public static string Encode(EstablishmentCursor cursor)
        => Base64Url.EncodeToString(
            Encoding.UTF8.GetBytes($"{cursor.Id}{Separator}{cursor.Name}"));

    /// <summary>
    /// Base64<em>url</em>, not plain base64: a cursor travels in a query string, where <c>+</c> means
    /// a space and <c>/</c> and <c>=</c> need escaping. The url alphabet avoids all three, so the
    /// value survives being copied around without anyone having to remember to encode it.
    /// </summary>
    public static bool TryDecode(string value, out EstablishmentCursor cursor)
    {
        cursor = null!;

        byte[] decoded;

        try
        {
            decoded = Base64Url.DecodeFromChars(value);
        }
        catch (FormatException)
        {
            // Not valid base64url. A caller sent something that was never a cursor.
            return false;
        }

        string text = Encoding.UTF8.GetString(decoded);

        int separator = text.IndexOf(Separator);

        if (separator <= 0 || !int.TryParse(text[..separator], out int id))
        {
            return false;
        }

        string name = text[(separator + 1)..];

        if (name.Length == 0)
        {
            return false;
        }

        cursor = new EstablishmentCursor(name, id);
        return true;
    }
}
