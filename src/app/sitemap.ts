import type { MetadataRoute } from 'next';

const baseUrl = 'https://wowcraft.io';

const professionSlugs = [
  'alchemy',
  'blacksmithing',
  'cooking',
  'enchanting',
  'engineering',
  'jewelcrafting',
  'leatherworking',
  'tailoring',
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date('2026-10-05T00:00:00.000Z');

  return [
    { url: baseUrl, lastModified, changeFrequency: 'weekly', priority: 1 },
    { url: `${baseUrl}/faq`, lastModified, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${baseUrl}/about`, lastModified, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${baseUrl}/privacy`, lastModified, changeFrequency: 'yearly', priority: 0.4 },
    ...professionSlugs.flatMap((slug) => [
      {
        url: `${baseUrl}/${slug}`,
        lastModified,
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      },
      {
        url: `${baseUrl}/guides/${slug}`,
        lastModified,
        changeFrequency: 'monthly' as const,
        priority: 0.7,
      },
    ]),
  ];
}
