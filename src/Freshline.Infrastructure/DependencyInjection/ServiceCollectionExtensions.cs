using Freshline.Core.Ingestion;
using Freshline.Infrastructure.Ingestion;
using Freshline.Infrastructure.Persistence;
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

    public static IServiceCollection AddFreshlineInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        string connectionString = configuration.GetConnectionString(ConnectionStringName)
            ?? throw new InvalidOperationException(
                $"No '{ConnectionStringName}' connection string is configured. Locally this comes from " +
                "user secrets or the environment; in Azure it comes from Key Vault via managed identity.");

        services.AddDbContext<FreshlineDbContext>(builder =>
            builder.UseSqlServer(connectionString, sqlServer => sqlServer.UseNetTopologySuite()));

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
