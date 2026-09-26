import { SymbolView } from 'expo-symbols';
import type { ColorValue } from 'react-native';

/** App icons: SF Symbols on iOS, Material Symbols on Android and web. */
const ICONS = {
  problem: { ios: 'exclamationmark.bubble', android: 'report', web: 'report' },
  idea: { ios: 'lightbulb', android: 'lightbulb', web: 'lightbulb' },
  project: { ios: 'hammer', android: 'rocket_launch', web: 'rocket_launch' },
  inbox: { ios: 'bell', android: 'notifications', web: 'notifications' },
  profile: { ios: 'person.crop.circle', android: 'person', web: 'person' },
  add: { ios: 'plus', android: 'add', web: 'add' },
  up: { ios: 'arrow.up', android: 'arrow_upward', web: 'arrow_upward' },
  down: { ios: 'arrow.down', android: 'arrow_downward', web: 'arrow_downward' },
  metoo: { ios: 'hand.raised', android: 'back_hand', web: 'back_hand' },
  comment: { ios: 'bubble.left', android: 'chat_bubble', web: 'chat_bubble' },
  lock: { ios: 'lock.fill', android: 'lock', web: 'lock' },
  public: { ios: 'globe', android: 'public', web: 'public' },
  team: { ios: 'person.2', android: 'group', web: 'group' },
  check: { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' },
  circle: { ios: 'circle', android: 'radio_button_unchecked', web: 'radio_button_unchecked' },
  verified: { ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' },
  close: { ios: 'xmark', android: 'close', web: 'close' },
  send: { ios: 'paperplane.fill', android: 'send', web: 'send' },
  clock: { ios: 'clock', android: 'schedule', web: 'schedule' },
  star: { ios: 'star.fill', android: 'star', web: 'star' },
  link: { ios: 'link', android: 'link', web: 'link' },
  reply: { ios: 'arrowshape.turn.up.left', android: 'reply', web: 'reply' },
  personAdd: { ios: 'person.badge.plus', android: 'person_add', web: 'person_add' },
  personCheck: { ios: 'person.fill.checkmark', android: 'how_to_reg', web: 'how_to_reg' },
  play: { ios: 'play.rectangle.fill', android: 'smart_display', web: 'smart_display' },
  share: { ios: 'square.and.arrow.up', android: 'share', web: 'share' },
  chevron: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
  chevronDown: { ios: 'chevron.down', android: 'keyboard_arrow_down', web: 'keyboard_arrow_down' },
  chevronUp: { ios: 'chevron.up', android: 'keyboard_arrow_up', web: 'keyboard_arrow_up' },
  edit: { ios: 'pencil', android: 'edit', web: 'edit' },
  trash: { ios: 'trash', android: 'delete', web: 'delete' },
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18, color }: { name: IconName; size?: number; color: ColorValue }) {
  return <SymbolView name={ICONS[name]} size={size} tintColor={color} />;
}
