using System.Net;
using System.Runtime.CompilerServices;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace Freshline.Infrastructure.Sources.Socrata;

/// <summary>
/// One row from a Socrata response, with its verbatim JSON alongside the parsed form.
///
/// <see cref="Element"/> is only valid for the duration of the iteration step that produced it —
/// the underlying <see cref="JsonDocument"/> is disposed once its page has been consumed. Read
/// what you need and map it immediately; do not stash it.
/// </summary>
public readonly record struct SocrataRow(JsonElement Element, string RawText);

/// <summary>
/// A minimal SoQL client: builds the query, pages through the result, retries the failures worth
/// retrying. It knows nothing about restaurants — the per-source meaning lives in connectors.
/// </summary>
public sealed class SocrataClient(HttpClient httpClient, ILogger<SocrataClient> logger)
{
    private const int MaxAttempts = 4;

    public async IAsyncEnumerable<SocrataRow> QueryAsync(
        string resourcePath,
        SocrataQuery query,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        // Socrata pages with $limit/$offset, and offset paging over an unordered result is not
        // stable: the server is free to return rows in a different order between requests, which
        // silently skips some rows and repeats others. An explicit sort is what makes the page
        // boundaries mean anything, so it is required rather than defaulted.
        if (string.IsNullOrWhiteSpace(query.Order))
        {
            throw new ArgumentException(
                "A Socrata query must specify $order. Offset paging without a total order skips and repeats rows.",
                nameof(query));
        }

        int offset = 0;

        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();

            string url = BuildUrl(resourcePath, query, offset);
            using JsonDocument page = await GetPageAsync(url, cancellationToken);

            int rowsInPage = 0;

            foreach (JsonElement element in page.RootElement.EnumerateArray())
            {
                rowsInPage++;
                yield return new SocrataRow(element, element.GetRawText());
            }

            logger.LogDebug("Socrata page at offset {Offset} returned {Rows} rows", offset, rowsInPage);

            // A short page is the end of the result set. Socrata has no total-count header on a
            // plain resource query, so this is the termination condition.
            if (rowsInPage < query.PageSize)
            {
                yield break;
            }

            offset += query.PageSize;
        }
    }

    private static string BuildUrl(string resourcePath, SocrataQuery query, int offset)
    {
        List<string> parameters =
        [
            $"$limit={query.PageSize}",
            $"$offset={offset}",
            $"$order={Uri.EscapeDataString(query.Order)}",
        ];

        if (!string.IsNullOrWhiteSpace(query.Where))
        {
            parameters.Add($"$where={Uri.EscapeDataString(query.Where)}");
        }

        return $"{resourcePath}?{string.Join('&', parameters)}";
    }

    private async Task<JsonDocument> GetPageAsync(string url, CancellationToken cancellationToken)
    {
        for (int attempt = 1; ; attempt++)
        {
            HttpResponseMessage response = await httpClient.GetAsync(url, cancellationToken);

            if (response.IsSuccessStatusCode)
            {
                await using Stream body = await response.Content.ReadAsStreamAsync(cancellationToken);
                return await JsonDocument.ParseAsync(body, cancellationToken: cancellationToken);
            }

            // Retry only what a retry can fix. Throttling and server faults are transient; a 400
            // means the SoQL is wrong and will be just as wrong in two seconds.
            bool worthRetrying =
                response.StatusCode == HttpStatusCode.TooManyRequests ||
                (int)response.StatusCode >= 500;

            if (!worthRetrying || attempt == MaxAttempts)
            {
                string detail = await response.Content.ReadAsStringAsync(cancellationToken);
                throw new HttpRequestException(
                    $"Socrata request failed with {(int)response.StatusCode} after {attempt} attempt(s): {url}. Body: {detail}",
                    inner: null,
                    statusCode: response.StatusCode);
            }

            TimeSpan delay = TimeSpan.FromSeconds(Math.Pow(2, attempt));
            logger.LogWarning(
                "Socrata returned {Status} for {Url}; retrying in {Delay}s (attempt {Attempt} of {Max})",
                (int)response.StatusCode, url, delay.TotalSeconds, attempt, MaxAttempts);

            await Task.Delay(delay, cancellationToken);
        }
    }
}
