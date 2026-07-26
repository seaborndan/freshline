using Freshline.Core.Model;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Freshline.Infrastructure.Persistence.Configurations;

public class SourceWatermarkConfiguration : IEntityTypeConfiguration<SourceWatermark>
{
    public void Configure(EntityTypeBuilder<SourceWatermark> builder)
    {
        builder.ToTable("SourceWatermarks");

        // The source is the key. One watermark per source, and the database will not let a
        // second one exist — which matters because two watermarks for one source would mean
        // two different answers to "where did we get to".
        builder.HasKey(w => w.SourceId);

        builder.Property(w => w.SourceId).HasConversion<int>().ValueGeneratedNever();
    }
}
