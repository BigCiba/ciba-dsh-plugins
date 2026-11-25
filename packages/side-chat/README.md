# Side chat

Fork the current conversation into an independent side chat that opens in the
right sidebar. The side chat inherits the conversation up to the latest
completed turn, then continues on its own: its messages, tool calls, and files
never enter the source conversation's context.

## Use

1. Open a conversation that has at least one completed turn.
2. Press the speech-bubble action at the right side of the conversation header.
3. The side chat opens as a right-sidebar tab with its own composer. Talk to it
   there while the main conversation stays untouched.
4. Press the same action again to reveal the open side chat. Close the tab and
   press it again to start a new fork from the conversation's latest completed
   turn.

## Notes

- The fork uses the same workspace and Agent preset as the source conversation.
- While the source conversation is mid-turn, the fork ends at the latest
  completed turn, not at the streaming step.
- A side chat is a temporary fork. Closing its tab archives the fork, stopping
  any work it still has running, so it stays out of the session list. Unarchive
  it from the archived filter of the session list to keep working on it.
- This version does not merge side-chat content back into the main thread.
