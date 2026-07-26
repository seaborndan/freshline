var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.AddHealthChecks();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseHttpsRedirection();

// The only endpoint at M0. Real endpoints arrive with a real data model in M4;
// this one exists so the host has something to prove it boots, in tests and in CI.
app.MapHealthChecks("/health");

app.Run();

// Exposes the implicitly-generated Program class to the test project so
// WebApplicationFactory<Program> can start the real host. Top-level statements
// generate an internal class, which the test assembly otherwise cannot see.
public partial class Program;
