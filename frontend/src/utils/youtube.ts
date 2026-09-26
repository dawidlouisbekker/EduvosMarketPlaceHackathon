/** The 11-character video id of a YouTube link, or null. */
export function youtubeId(url: string) {
  return url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/)?.[1] ?? null;
}

export const youtubeThumbnail = (id: string) => `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
