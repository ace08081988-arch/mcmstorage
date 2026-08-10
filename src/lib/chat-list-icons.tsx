import {
  Tag, Star, Heart, Bot, Users, MapPin, Briefcase, ShoppingBag, Shield, Flag,
  type LucideIcon,
} from "lucide-react";

const MAP: Record<string, LucideIcon> = {
  tag: Tag,
  star: Star,
  heart: Heart,
  bot: Bot,
  users: Users,
  "map-pin": MapPin,
  briefcase: Briefcase,
  "shopping-bag": ShoppingBag,
  shield: Shield,
  flag: Flag,
};

export function ChatListIcon({
  name,
  className,
  style,
}: {
  name: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const Icon = MAP[name] ?? Tag;
  return <Icon className={className} style={style} aria-hidden />;
}

export function getChatListIcon(name: string): LucideIcon {
  return MAP[name] ?? Tag;
}
