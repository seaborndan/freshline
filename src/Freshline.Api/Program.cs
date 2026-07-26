using System.Text.Json.Serialization;
using Freshline.Api.Endpoints;
using Freshline.Api.Health;
using Freshline.Infrastructure.DependencyInjection;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

// The database and the read path over it — and deliberately not AddFreshlineInfrastructure, which
// would also register the NYC connector's HttpClient and refuse to start without that source's
// configuration. The API never fetches from a portal.
builder.Services.AddFreshlinePersistence(builder.Configuration);

// One error shape for the whole API: RFC 9457 ProblemDetails. Without this, a failure returns
// either an empty body or, in development, an HTML stack trace page — two different contracts for
// the same API depending on the environment it happens to be running in.
builder.Services.AddProblemDetails();

builder.Services.ConfigureHttpJsonOptions(options =>
{
    // Enums as their names, not their numbers. The default writes Outcome as 1, which tells a
    // client nothing and silently changes meaning if anyone ever reorders the enum. "Good" cannot
    // be misread and cannot drift.
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());

    // Nulls are written rather than omitted. A field that disappears when it is null makes callers
    // distinguish "absent" from "null" for no reason, and here null is frequently the answer:
    // a grade is null on a large share of inspections, and coordinates are null on some
    // establishments. Those are facts about the data and the response should state them.
});

builder.Services.AddOpenApi();

builder.Services
    .AddHealthChecks()
    .AddCheck<ReadinessHealthCheck>("database", tags: [ReadinessHealthCheck.ReadyTag]);

var app = builder.Build();

// Turns an unhandled exception into a 500 ProblemDetails with no stack trace, rather than into a
// developer exception page. Registered first so it wraps everything after it.
app.UseExceptionHandler();

// Gives a ProblemDetails body to responses that have a status code and no body of their own —
// the 404 from a route that matched nothing, the 405 from a wrong verb. Without it those come back
// with an empty body, which is a different error contract for exactly the failures a caller is
// most likely to hit while learning the API.
app.UseStatusCodePages();

app.UseHttpsRedirection();

// The OpenAPI document and its UI are served in every environment, not just development.
//
// That is the opposite of the usual advice, and it is a deliberate reading of what this API is:
// the read paths are public and anonymous by design, so the document describes nothing a caller
// could not discover by using it. M4 is done when a stranger can explore live Swagger, and gating
// it to development would mean that criterion is only ever met on a machine no stranger can reach.
app.MapOpenApi();
app.MapScalarApiReference(options => options.WithTitle("Freshline API"));

// Liveness: is this process up and answering. It runs no checks — that is what Predicate false
// means — because a liveness probe that fails when a dependency is down causes a restart that
// cannot fix a dependency.
app.MapHealthChecks("/health", new HealthCheckOptions { Predicate = _ => false });

// Readiness: can this instance serve a request right now. Runs the database check, so it reports
// unhealthy when the store is unreachable — which is the situation a load balancer should react to
// by sending traffic elsewhere rather than by restarting anything.
app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = registration => registration.Tags.Contains(ReadinessHealthCheck.ReadyTag),
});

// Version in the path, as a literal string. A versioning package would add a configuration surface
// and a dependency for a v1 that has no v2; the discipline that actually matters is evolving
// without a v2 at all — add optional fields, never remove or repurpose one.
RouteGroupBuilder api = app.MapGroup("/api/v1");

api.MapEstablishmentEndpoints();

app.Run();

// Exposes the implicitly-generated Program class to the test project so
// WebApplicationFactory<Program> can start the real host. Top-level statements
// generate an internal class, which the test assembly otherwise cannot see.
public partial class Program;
