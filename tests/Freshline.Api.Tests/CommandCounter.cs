using Microsoft.Extensions.Logging;

namespace Freshline.Api.Tests;

/// <summary>
/// Counts the SQL commands Entity Framework actually executes, by listening to the events EF already
/// emits rather than by wrapping anything.
///
/// <para>This exists so "the detail endpoint is one round trip" can be an assertion rather than
/// something someone once observed in a log. An N+1 is invisible from the outside — the response is
/// byte-for-byte identical, every other test still passes, and the only symptom is latency that
/// grows with the size of the result. Counting commands is the only way to make that failure loud.
/// </para>
///
/// <para><strong>Why a logger provider and not an interceptor.</strong> The first attempt registered
/// an <c>IInterceptor</c> as a singleton in the test host, on the understanding that EF discovers
/// interceptors from the application's service provider. It counted zero: <c>WebApplicationFactory</c>
/// applies its service registrations after the host has configured its own, and the interceptor was
/// never picked up. This route hooks the logging EF emits regardless, which is the same source the
/// SQL in <c>docs/performance.md</c> was captured from.</para>
///
/// <para>Tests in a collection run sequentially, which is what makes reset-then-act-then-assert
/// safe.</para>
/// </summary>
public sealed class CommandCounter : ILoggerProvider
{
    /// <summary>EF Core's <c>RelationalEventId.CommandExecuted</c>. Executed rather than executing,
    /// so a command that failed to run is not counted as one that did.</summary>
    private const int CommandExecutedEventId = 20101;

    internal const string Category = "Microsoft.EntityFrameworkCore.Database.Command";

    private int _count;

    public int Count => Volatile.Read(ref _count);

    public void Reset() => Interlocked.Exchange(ref _count, 0);

    public ILogger CreateLogger(string categoryName) =>
        categoryName == Category ? new CountingLogger(this) : NullLogger.Instance;

    public void Dispose()
    {
    }

    private sealed class CountingLogger(CommandCounter owner) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Information;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (eventId.Id == CommandExecutedEventId)
            {
                Interlocked.Increment(ref owner._count);
            }
        }
    }

    private sealed class NullLogger : ILogger
    {
        public static readonly NullLogger Instance = new();

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => false;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
        }
    }
}
