import { useMemo, useState } from "react";
import { Smile } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Emoji & simbol picker ringan (tanpa dependency eksternal). Kategori
 * disusun manual supaya bundling tetap kecil dan render instan di WebView
 * Android — cukup untuk kebutuhan chat sehari-hari.
 */

type Category = { id: string; label: string; chars: string[] };

const CATEGORIES: Category[] = [
  {
    id: "smiley",
    label: "😀",
    chars: [
      "😀","😁","😂","🤣","😊","🙂","😉","😍","😘","😜","🤪","🤩","🥰","😎","🤗","🤔",
      "🙃","😴","😇","🥳","😭","😢","😅","😳","🤯","😡","😤","🥺","😱","🤢","🤒","🤧",
    ],
  },
  {
    id: "hand",
    label: "👍",
    chars: [
      "👍","👎","👌","🙏","👏","🙌","👐","🤝","🤲","💪","✌️","🤞","🤟","🤘","👊","✊",
      "☝️","👆","👇","👈","👉","🖐️","✋","🖖","💅","👋",
    ],
  },
  {
    id: "heart",
    label: "❤️",
    chars: [
      "❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💖","💗","💓","💞","💕","💘","💝",
      "💔","❣️","💟","♥️","💌","💋",
    ],
  },
  {
    id: "obj",
    label: "🎁",
    chars: [
      "🎁","🎉","🎊","🎂","🍰","☕","🍵","🍺","🍷","🍹","🍔","🍟","🍕","🍜","🍚","🍎",
      "🍌","🍇","🍉","🥑","🥦","📦","🚚","🛒","💳","💵","💰","🏷️","🧾","📌","📍","📞",
      "📱","💻","🖨️","🔑","🔒","🔓","📷","🎧","⚡","🔥","🌟","✨","🎯","🏆","🎨","🛠️",
    ],
  },
  {
    id: "symbol",
    label: "✅",
    chars: [
      "✅","☑️","✔️","❌","⛔","🚫","⚠️","❗","❓","‼️","⁉️","💯","🆗","🆕","🆓","🔴",
      "🟢","🟡","🔵","⚫","⚪","🟠","🟣","🟤","➕","➖","➗","✖️","♾️","©️","®️","™️",
      "★","☆","→","←","↑","↓","↔️","↕️","➡️","⬅️","⬆️","⬇️","«","»","•","·","¶","§",
      "°","µ","€","$","£","¥","₹","₽","฿","¢","№","%","‰",
    ],
  },
];

type Props = {
  onPick: (ch: string) => void;
  disabled?: boolean;
};

export function EmojiPickerPopover({ onPick, disabled }: Props) {
  const [tab, setTab] = useState<string>(CATEGORIES[0].id);
  const active = useMemo(() => CATEGORIES.find((c) => c.id === tab) ?? CATEGORIES[0], [tab]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={disabled}
          aria-label="Emoji & simbol"
          className="shrink-0"
        >
          <Smile className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-72 p-2"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="mb-2 flex gap-1 border-b pb-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setTab(c.id)}
              className={`flex-1 rounded-md px-1 py-1 text-lg leading-none transition ${
                tab === c.id ? "bg-accent" : "hover:bg-accent/60"
              }`}
              aria-label={`Kategori ${c.id}`}
              aria-pressed={tab === c.id}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div
          className="grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto"
          role="listbox"
          aria-label={`Emoji ${active.id}`}
        >
          {active.chars.map((ch, i) => (
            <button
              key={`${active.id}-${i}`}
              type="button"
              onClick={() => onPick(ch)}
              className="rounded-md p-1 text-xl leading-none transition hover:bg-accent active:scale-95"
              aria-label={ch}
            >
              {ch}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}