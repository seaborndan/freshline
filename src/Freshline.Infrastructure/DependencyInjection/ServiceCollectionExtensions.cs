using Freshline.Core.Ingestion;
using Freshline.Core.Queries;
using Freshline.Infrastructure.Ingestion;
using Freshline.Infrastructure.Persistence;
using Freshline.Infrastructure.Queries;
using Freshline.Infrastructure.Sources.Nyc;
using Freshline.Infrastructure.Sources.Socrata;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Freshline.Infrastructure.DependencyInjection;

public static class ServiceCollectionExtensions
{
    /// <summary>The connection string name used by every host that talks to the Freshline database.</summary>
    public const string ConnectionStringName = "Freshline";

    /// <summary>
    /// Everything the ingestion worker needs: the database and the source connectors.
    /// </summary>
    public static IServiceCollection AddFreshlineInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
        => services
            .AddFreshlinePersistence(configuration)
            .AddFreshlineIngestion(configuration);

    /// <summary>
    /// The database and the read path over it. This is all the API takes.
    ///
    /// <para><strong>Why this is separate from <see cref="AddFreshlineIngestion"/>.</strong> The
    /// connector registration binds <c>NycDohmhOptions</c> with <c>ValidateOnStart</c> and creates a
    /// named <c>HttpClient</c> pointed at NYC's portal. An API that called it would refuse to start
    /// unless a source it never talks to was configured, and would hold a connection pool to a
    /// portal it never calls. Those are the worker's concerns, and the API should not inherit them
    /// just because both processes talk to the same database.</para>
    /// </summary>
    public static IServiceCollection AddFreshlinePersistence(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        string connectionString = configuration.GetConnectionString(ConnectionStringName)
            ?? throw new InvalidOperationException(
                $"No '{ConnectionStringName}' connection string is configured. Locally this comes from " +
                "user secrets or the environment; in Azure it comes from Key Vault via managed identity.");

        services.AddDbContext<FreshlineDbContext>(builder =>
            builder.UseSqlServer(connectionString, sqlServer => sqlServer
                .UseNetTopologySuite()

                // Retry on transient faults, which on Azure SQL are ordinary rather than
                // exceptional — a failover or a throttle closes connections and the platform expects
                // the client to come back.
                //
                // The case that forced this is sharper than "the cloud is flaky". A serverless
                // database auto-pauses when idle, and Microsoft documents the resume path exactly:
                // the first connection attempt *fails* with error 40613, starts the resume, and the
                // caller is expected to retry. Without this the first visitor after an idle period
                // gets a 500 — which is precisely the visitor this project exists for, and precisely
                // the moment ADR-0005 says a tab gets closed.
                //
                // Six attempts over up to 30 seconds, because a resume is documented as taking
                // "on the order of one minute" at worst and a retry budget shorter than the event it
                // exists to survive would only convert one failure into six.
                .EnableRetryOnFailure(maxRetryCount: 6, maxRetryDelay: TimeSpan.FromSeconds(30), errorNumbersToAdd: null)));

        services.AddScoped<IEstablishmentQueries, EstablishmentQueries>();
        services.AddScoped<IReportQueries, ReportQueries>();
        services.AddScoped<IReadinessProbe, ReadinessProbe>();

        return services;
    }

    /// <summary>Fetching from sources and writing the results. The worker's half.</summary>
    public static IServiceCollection AddFreshlineIngestion(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        // ValidateOnStart turns a misconfigured source into a startup failure with a readable
        // message, rather than a null reference on the first fetch an hour into a schedule.
        services
            .AddOptions<NycDohmhOptions>()
            .Bind(configuration.GetSection(NycDohmhOptions.SectionName))
            .ValidateDataAnnotations()
            .ValidateOnStart();

        services.TryAddSingleton(TimeProvider.System);

        services.AddSourceConnector<NycDohmhConnector, NycDohmhOptions>(
            httpClientName: "socrata-nyc",
            baseAddressOf: settings => settings.BaseAddress,
            appTokenOf: settings => settings.AppToken,
            connectorFactory: static (socrata, provider) => new NycDohmhConnector(
                socrata,
                provider.GetRequiredService<IOptions<NycDohmhOptions>>(),
                provider.GetRequiredService<TimeProvider>(),
                provider.GetRequiredService<ILogger<NycDohmhConnector>>()));

        services.AddScoped<IIngestionRunner, IngestionRunner>();

        return services;
    }

    /// <summary>
    /// Registers one connector together with its own named <see cref="HttpClient"/>.
    ///
    /// Each source gets its own client rather than sharing one, because base address, app token
    /// and eventually timeouts and rate limits are per-portal. Giving <see cref="SocrataClient"/>
    /// a base address from one city's settings would quietly make it that city's client, which is
    /// the sort of shortcut ADR-0002's layout exists to prevent.
    /// </summary>
    private static IServiceCollection AddSourceConnector<TConnector, TOptions>(
        this IServiceCollection services,
        string httpClientName,
        Func<TOptions, string> baseAddressOf,
        Func<TOptions, string?> appTokenOf,
        Func<SocrataClient, IServiceProvider, TConnector> connectorFactory)
        where TConnector : class, ISourceConnector
        where TOptions : class
    {
        services.AddHttpClient(httpClientName, (provider, client) =>
        {
            TOptions settings = provider.GetRequiredService<IOptions<TOptions>>().Value;

            client.BaseAddress = new Uri(baseAddressOf(settings));
            client.DefaultRequestHeaders.Add("Accept", "application/json");

            // Optional. Socrata's unauthenticated rate limit is ample at this volume, which is
            // why nothing in this project needs a secret to run locally.
            string? appToken = appTokenOf(settings);
            if (!string.IsNullOrWhiteSpace(appToken))
            {
                client.DefaultRequestHeaders.Add("X-App-Token", appToken);
            }
        });

        services.AddScoped<ISourceConnector>(provider =>
        {
            HttpClient httpClient = provider
                .GetRequiredService<IHttpClientFactory>()
                .CreateClient(httpClientName);

            SocrataClient socrataClient = new(httpClient, provider.GetRequiredService<ILogger<SocrataClient>>());

            return connectorFactory(socrataClient, provider);
        });

        return services;
    }
}
