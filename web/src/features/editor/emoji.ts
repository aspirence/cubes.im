/**
 * A `:` emoji picker, hand-rolled.
 *
 * `@tiptap/extension-emoji` is the official answer and it pulls `emojibase-data`
 * — 50 MB unpacked, every locale of every emoji with shortcodes, groups and
 * skin-tone variants. That is a real cost for a feature whose entire job is
 * letting someone type `:tada:`. This list is the couple of hundred people
 * actually reach for, at a few kilobytes, and adding one is a one-line edit.
 */
export interface EmojiItem {
  emoji: string;
  name: string;
  /** Extra words the search should match beyond `name`. */
  keywords: string;
}

export const EMOJIS: EmojiItem[] = [
  // reactions
  { emoji: "👍", name: "thumbsup", keywords: "yes ok approve like +1" },
  { emoji: "👎", name: "thumbsdown", keywords: "no reject dislike -1" },
  { emoji: "🎉", name: "tada", keywords: "party celebrate launch ship" },
  { emoji: "🚀", name: "rocket", keywords: "launch ship fast deploy" },
  { emoji: "🔥", name: "fire", keywords: "hot great urgent" },
  { emoji: "✅", name: "check", keywords: "done tick complete yes" },
  { emoji: "❌", name: "cross", keywords: "no fail wrong remove" },
  { emoji: "⚠️", name: "warning", keywords: "caution careful risk" },
  { emoji: "❓", name: "question", keywords: "ask unsure help" },
  { emoji: "❗", name: "exclamation", keywords: "important attention" },
  { emoji: "💡", name: "bulb", keywords: "idea suggestion tip" },
  { emoji: "📌", name: "pushpin", keywords: "pin important note" },
  { emoji: "⭐", name: "star", keywords: "favourite important rating" },
  { emoji: "💯", name: "hundred", keywords: "perfect full score" },
  { emoji: "👀", name: "eyes", keywords: "look watch review" },
  { emoji: "🙏", name: "pray", keywords: "thanks please hope" },
  { emoji: "👏", name: "clap", keywords: "applause well done" },
  { emoji: "🤝", name: "handshake", keywords: "deal agree partner" },
  { emoji: "💪", name: "muscle", keywords: "strong effort" },
  { emoji: "🧠", name: "brain", keywords: "smart think idea" },

  // faces
  { emoji: "😀", name: "grinning", keywords: "happy smile" },
  { emoji: "😂", name: "joy", keywords: "laugh funny lol" },
  { emoji: "🙂", name: "slight_smile", keywords: "happy ok" },
  { emoji: "😉", name: "wink", keywords: "joke" },
  { emoji: "😍", name: "heart_eyes", keywords: "love like" },
  { emoji: "🤔", name: "thinking", keywords: "hmm consider unsure" },
  { emoji: "😅", name: "sweat_smile", keywords: "phew nervous" },
  { emoji: "😬", name: "grimace", keywords: "awkward yikes" },
  { emoji: "😴", name: "sleeping", keywords: "tired bored" },
  { emoji: "😭", name: "sob", keywords: "cry sad" },
  { emoji: "😡", name: "rage", keywords: "angry mad" },
  { emoji: "🤯", name: "exploding_head", keywords: "wow mind blown" },
  { emoji: "🥳", name: "partying", keywords: "celebrate birthday" },
  { emoji: "😎", name: "sunglasses", keywords: "cool" },

  // work
  { emoji: "📝", name: "memo", keywords: "note write doc draft" },
  { emoji: "📄", name: "page", keywords: "document file" },
  { emoji: "📊", name: "chart", keywords: "report analytics data" },
  { emoji: "📈", name: "chart_up", keywords: "growth increase win" },
  { emoji: "📉", name: "chart_down", keywords: "decline drop loss" },
  { emoji: "📅", name: "calendar", keywords: "date schedule meeting" },
  { emoji: "⏰", name: "alarm", keywords: "deadline reminder time" },
  { emoji: "⏳", name: "hourglass", keywords: "waiting pending time" },
  { emoji: "🔗", name: "link", keywords: "url reference" },
  { emoji: "📎", name: "paperclip", keywords: "attach file" },
  { emoji: "🔍", name: "search", keywords: "find look investigate" },
  { emoji: "🏷️", name: "label", keywords: "tag category" },
  { emoji: "📢", name: "announce", keywords: "announcement broadcast news" },
  { emoji: "💬", name: "speech", keywords: "comment chat discuss" },
  { emoji: "📧", name: "email", keywords: "mail message" },
  { emoji: "📞", name: "phone", keywords: "call ring" },
  { emoji: "💰", name: "money", keywords: "cost budget price revenue" },
  { emoji: "🧾", name: "receipt", keywords: "invoice bill expense" },
  { emoji: "🎯", name: "target", keywords: "goal objective aim" },
  { emoji: "🗓️", name: "spiral_calendar", keywords: "planning roadmap" },

  // build / status
  { emoji: "🐛", name: "bug", keywords: "issue defect error" },
  { emoji: "🔧", name: "wrench", keywords: "fix tool config" },
  { emoji: "🛠️", name: "tools", keywords: "build maintain" },
  { emoji: "⚙️", name: "gear", keywords: "settings config" },
  { emoji: "🚧", name: "construction", keywords: "wip in progress blocked" },
  { emoji: "🧪", name: "test", keywords: "experiment try qa" },
  { emoji: "🔒", name: "lock", keywords: "secure private closed" },
  { emoji: "🔓", name: "unlock", keywords: "open public" },
  { emoji: "♻️", name: "recycle", keywords: "refactor reuse" },
  { emoji: "🗑️", name: "trash", keywords: "delete remove bin" },
  { emoji: "✏️", name: "pencil", keywords: "edit change" },
  { emoji: "📦", name: "package", keywords: "release build ship" },
  { emoji: "🌱", name: "seedling", keywords: "new start grow" },
  { emoji: "🧹", name: "broom", keywords: "cleanup tidy" },

  // people / misc
  { emoji: "🙌", name: "raised_hands", keywords: "celebrate praise" },
  { emoji: "👋", name: "wave", keywords: "hello hi bye" },
  { emoji: "🫡", name: "salute", keywords: "on it yes acknowledged" },
  { emoji: "❤️", name: "heart", keywords: "love like" },
  { emoji: "☕", name: "coffee", keywords: "break morning" },
  { emoji: "🍕", name: "pizza", keywords: "food lunch" },
  { emoji: "🎨", name: "art", keywords: "design creative ui" },
  { emoji: "📱", name: "mobile", keywords: "phone app device" },
  { emoji: "💻", name: "laptop", keywords: "computer dev code" },
  { emoji: "🌍", name: "globe", keywords: "world global public" },
  { emoji: "⚡", name: "zap", keywords: "fast quick performance" },
  { emoji: "🧊", name: "ice", keywords: "frozen cold on hold" },
  { emoji: "🎬", name: "clapper", keywords: "video film shoot" },
  { emoji: "📷", name: "camera", keywords: "photo image shoot" },
  { emoji: "🎵", name: "music", keywords: "audio sound" },
];

/** Name-first ranking: typing `:fire` should put 🔥 above anything merely tagged "fire". */
export function searchEmojis(query: string, limit = 8): EmojiItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return EMOJIS.slice(0, limit);

  const starts: EmojiItem[] = [];
  const contains: EmojiItem[] = [];
  const keyword: EmojiItem[] = [];
  for (const e of EMOJIS) {
    if (e.name.startsWith(q)) starts.push(e);
    else if (e.name.includes(q)) contains.push(e);
    else if (e.keywords.includes(q)) keyword.push(e);
  }
  return [...starts, ...contains, ...keyword].slice(0, limit);
}
