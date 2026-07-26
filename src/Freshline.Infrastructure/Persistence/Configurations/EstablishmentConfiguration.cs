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

        builder.Property(e => e.Location).HasColumnType("geography");

        // The spatial index itself is created with raw SQL in the migration. EF's migration API has
        // no first-class support for CREATE SPATIAL INDEX and its tessellation options, and hiding
        // that behind a helper would obscure the one line here that actually determines whether the
        // map query is fast.
        //
        // The old composite index on (Latitude, Longitude) was dropped in the same migration. It
        // indexed two nullable floats that nothing queried, and a B-tree on two independent columns
        // cannot answer a two-dimensional range query anyway — it can seek on latitude and must
        // then scan every row in that band. That is the "naive" half of the M3 measurement.

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
