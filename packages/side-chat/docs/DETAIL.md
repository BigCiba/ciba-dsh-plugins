# Side chat

Side chat forks the conversation you are reading into an independent Session
and opens it in the right sidebar. It is the Codex-style "side conversation":
you can explore a question, draft a plan, or argue with the agent without the
side thread's messages or tool calls becoming part of the main conversation.

## What it does

- Adds a speech-bubble action to the right side of the conversation header.
- Forks the current Session at the latest completed turn, using the same
  independent-fork operation as the Chat footer's branch action.
- Opens the fork as a right-sidebar tab with the shared Conversation body, its
  own composer, model selector, and transcript.
- Keeps the source conversation unchanged: the side chat is another Session
  with its own log.

## How to use it

1. Open a conversation with at least one completed turn.
2. Press the speech-bubble action in the conversation header.
3. Continue the discussion in the right-sidebar tab.
4. Press the same action again to reveal the open side chat. Close its tab and
   press again to fork the conversation's latest state.

## Limits

- A fork always ends at the latest completed turn. An in-flight turn is not
  copied, even though the main conversation continues to stream.
- A side chat is a temporary fork, not a second permanent thread. Closing its
  tab archives the fork and stops any work it still has running, keeping it out
  of the session list. Unarchive it from the archived filter of the session
  list to keep working on it.
- Side-chat content is not merged back into the main thread in this version.
