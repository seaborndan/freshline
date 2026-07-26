using Freshline.Core.Model;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Freshline.Infrastructure.Persistence.Configurations;

public class EstablishmentConfiguration : IEntityTypeConfiguration<Establishment>
{
    public void Configure(EntityTypeBuilder<Establishment> builder)
    {
        builder.ToTable("Establishments");

        builder.HasKey(e => e.Id);

        builder.Property(e => e.SourceId).HasConversion<int>();

        builder.Property(e => e.ExternalId).HasMaxLength(ColumnWidths.ExternalId).IsRequired();
        builder.Property(e => e.Name).HasMaxLength(ColumnWidths.Name).IsRequired();
        builder.Property(e => e.Cuisine).HasMaxLength(ColumnWidths.Cuisine);
        builder.Property(e => e.Phone).HasMaxLength(ColumnWidths.Phone);
        builder.Property(e => e.AddressLine).HasMaxLength(ColumnWidths.AddressLine);
        builder.Property(e => e.Locality).HasMaxLength(ColumnWidths.Locality);
        builder.Property(e => e.PostalCode).HasMaxLength(ColumnWidths.PostalCode);

        // Identity, per ADR-0002. Enforced in the database and not only in code, because the
        // application is not the only thing that will ever write here.
        builder
            .HasIndex(e => new { e.SourceId, e.ExternalId })
            .IsUnique()
            .HasDatabaseName("UX_Establishments_SourceId_ExternalId");

        // The map's primary filter is "what is in this part of the map". A real spatial index on
        // a geography column arrives at M3; this is the ordinary index that makes the interim
        // bounding-box query non-terrible, and it is not a substitute for one.
        builder
            .HasIndex(e => new { e.Latitude, e.Longitude })
            .HasDatabaseName("IX_Establishments_Latitude_Longitude");

        builder
            .HasOne(e => e.SourceRecord)
            .WithMany()
            .HasForeignKey(e => e.SourceRecordId)
            // Restrict, not Cascade. SourceRecord is referenced by all three canonical entities,
            // and cascading from it would give SQL Server multiple cascade paths to Violation —
            // which it rejects outright at migration time.
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasMany(e => e.Inspections)
            .WithOne(i => i.Establishment)
            .HasForeignKey(i => i.EstablishmentId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
