using System.Reflection;

namespace Freshline.Api.Tests;

/// <summary>
/// The dependency rule in `CLAUDE.md`, enforced instead of described.
///
/// <para>The rule names the specific shortcut the layout exists to prevent: "just this once, the API
/// will query the DbContext directly". M4 is where that becomes tempting, because every endpoint in
/// it is a query. A comment asking people not to do it is worth nothing on the afternoon somebody
/// needs one more field.</para>
/// </summary>
public class ArchitectureTests
{
    /// <summary>
    /// The API project references Infrastructure, because the host has to call
    /// <c>AddFreshlinePersistence</c> at startup. That reference is also the door through which a
    /// <c>DbContext</c> could walk into an endpoint.
    ///
    /// <para>The check works because the C# compiler only emits an assembly reference for an
    /// assembly whose types are actually used. Entity Framework reaches the API project
    /// transitively, so it is available to compile against — and if any code here touched an EF
    /// type, its assembly name would appear in this list. Today it does not.</para>
    ///
    /// <para>Its limit, stated so nobody trusts it further than it goes: this proves no EF
    /// <em>type</em> is referenced. It would not catch raw SQL sent some other way, and it says
    /// nothing about the other two projects.</para>
    /// </summary>
    [Fact]
    public void The_api_assembly_does_not_reference_entity_framework()
    {
        IEnumerable<string> referenced = typeof(Program).Assembly
            .GetReferencedAssemblies()
            .Select(assembly => assembly.Name ?? string.Empty);

        string[] entityFramework = referenced
            .Where(name => name.StartsWith("Microsoft.EntityFrameworkCore", StringComparison.Ordinal))
            .ToArray();

        Assert.True(
            entityFramework.Length == 0,
            "Freshline.Api references Entity Framework: " + string.Join(", ", entityFramework) +
            ". Queries belong in Infrastructure behind an interface declared in Core — see " +
            "IEstablishmentQueries. If an endpoint needs data the read path does not expose, widen " +
            "the read path rather than reaching past it.");
    }

    /// <summary>
    /// The same rule from the other direction: Core is where the contracts live, and it must stay
    /// free of infrastructure. NetTopologySuite is the one deliberate exception, argued in ADR-0004
    /// on the grounds that a geometry library is domain vocabulary rather than infrastructure — and
    /// ADR-0004 says explicitly that a second exception needs its own argument rather than treating
    /// this one as precedent. This test is what makes "a second one needs an argument" true.
    /// </summary>
    [Fact]
    public void Core_references_nothing_but_the_framework_and_netTopologySuite()
    {
        string[] allowed =
        [
            "System",
            "netstandard",
            "NetTopologySuite",
        ];

        string[] unexpected = typeof(Freshline.Core.Queries.IEstablishmentQueries).Assembly
            .GetReferencedAssemblies()
            .Select(assembly => assembly.Name ?? string.Empty)
            .Where(name => !allowed.Any(prefix => name.StartsWith(prefix, StringComparison.Ordinal)))
            .ToArray();

        Assert.True(
            unexpected.Length == 0,
            "Freshline.Core has picked up a dependency that is not argued for: " +
            string.Join(", ", unexpected) + ". Per CLAUDE.md and ADR-0004, a package reference in " +
            "Core is a decision that needs an ADR, not an implementation detail.");
    }
}
