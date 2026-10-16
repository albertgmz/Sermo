import { pollsGet } from "@sermo/core/contracts";
import { LazyArt } from "@/components/forum/art";
import { LazyPoll } from "@/components/forum/poll-lazy";
import { readIfAllowed } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { pollForClient } from "@/lib/sermo/polls";

// The poll or quiz of a thread that has one. The pictures are drawn here, where the data saver is
// known (`LazyArt` is the gate: a blocked picture becomes the placeholder and its address is
// never written), and handed to the block by file id. The block is keyed by when the poll last
// changed, so an edit that redraws the page draws it anew. The counts are not search text: they
// are marked `data-nosnippet` in the block. The block is handed the poll without the pictures'
// addresses: only their file ids, which key the pictures drawn here. A poll the backend does not
// give to this visitor (the text closed to them, the poll gone, a failing read) is no poll: the
// thread is still read.
export async function ThreadPoll({
  threadId,
  signedIn,
  attachIn,
}: {
  threadId: number;
  signedIn: boolean;
  attachIn: number | null;
}) {
  let found: Awaited<
    ReturnType<
      typeof readIfAllowed<typeof pollsGet.input, typeof pollsGet.output>
    >
  >;
  try {
    found = await readIfAllowed(pollsGet, { threadId });
  } catch (error) {
    // Whatever the backend answers, the poll is the only thing lost: the thread is still read.
    // (Anything that is not the backend's answer, Next's own redirects included, passes.)
    if (error instanceof SermoError) return null;
    throw error;
  }
  const poll = found?.poll;
  if (!poll) return null;
  const pictures: Record<number, React.ReactNode> = {};
  for (const question of poll.questions)
    for (const image of [
      question.image,
      ...question.answers.map((answer) => answer.image),
    ])
      if (image)
        pictures[image.fileId] = (
          <LazyArt
            src={image.url}
            category="postImages"
            className="aspect-video max-h-56 w-full rounded-md"
          />
        );
  return (
    <LazyPoll
      key={poll.updatedAt}
      poll={pollForClient(poll)}
      threadId={threadId}
      pictures={pictures}
      signedIn={signedIn}
      attachIn={attachIn}
    />
  );
}
