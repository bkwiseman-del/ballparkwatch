import { youTubeEmbedUrl } from '@/lib/youtube'

// A 16:9 YouTube embed. Used on the Watch page (live game video) and in the
// scorer's video/latency screen (preview).
export function YouTubeEmbed({
  videoId,
  autoplay = false,
  title = 'Live video',
}: {
  videoId: string
  autoplay?: boolean
  title?: string
}) {
  return (
    <div className="relative aspect-video w-full bg-black">
      <iframe
        key={`${videoId}-${autoplay}`}
        className="absolute inset-0 h-full w-full"
        src={youTubeEmbedUrl(videoId, { autoplay })}
        title={title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  )
}
