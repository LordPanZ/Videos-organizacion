/**
 * Passing a video on to someone else.
 *
 * What travels is the original link, not a copy of the video: the recipient
 * opens it on the platform it came from, and nothing leaves the device except
 * the address and the name.
 */

/** What a shared video says, with its own line for the link. */
export function shareText(video: { title: string; url: string }): string {
  const title = video.title.trim();
  return title && title !== video.url ? `${title}\n${video.url}` : video.url;
}

/**
 * A link that hands the message to WhatsApp.
 *
 * `wa.me` is WhatsApp's own address for this: on a phone it opens the app, on
 * a computer it opens WhatsApp Web, and it needs nothing installed to build.
 */
export function whatsappLink(video: { title: string; url: string }): string {
  return `https://wa.me/?text=${encodeURIComponent(shareText(video))}`;
}
