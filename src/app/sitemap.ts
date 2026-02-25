import type { MetadataRoute } from 'next';

const professions = [
  'alchemy',
  'blacksmithing',
  'enchanting',
  'engineering',
  'jewelcrafting',
  'leatherworking',
  'tailoring',
];

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://wowcraft.io';

  const entries: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
    ...professions.map((profession) => ({
      url: `${baseUrl}/${profession}`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ];

  return entries;
}
