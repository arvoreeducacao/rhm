import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { releases } from "../data/releases";

export function GET(context: APIContext) {
  return rss({
    title: "Repo Hub Releases",
    description: "Changelog and release history for Repo Hub CLI.",
    site: context.site!,
    items: releases.map((release) => ({
      title: `v${release.version} — ${release.title}`,
      description: release.summary,
      pubDate: new Date(release.date + "T00:00:00"),
      link: `/releases/${release.slug}`,
    })),
  });
}
