/**
 * The keys of the web app's icon set (`apps/web/src/components/icons/icon-set.ts`) an award may
 * take as its icon. The backend refuses any other key, so an award cannot be saved with an icon the
 * site would not draw. Copied from the set, because the backend does not import web code; a test
 * in the web app holds the two equal, so a key added to the set is added here too.
 */
export const AWARD_ICON_KEYS: ReadonlySet<string> = new Set(
  `
messages-square message-circle-more message-circle megaphone newspaper book-open library
graduation-cap lightbulb circle-help info flag bookmark tag hash star heart thumbs-up smile
party-popper trophy award medal crown gift shopping-cart shopping-bag store credit-card
wallet bitcoin coins banknote badge-dollar-sign percent receipt package truck handshake
briefcase-business chart-line chart-column trending-up square-terminal code terminal cpu
server database hard-drive smartphone laptop monitor keyboard mouse wifi globe earth cloud
bug shield-check lock key-round wrench settings hammer puzzle bot rocket gamepad-2 dices
swords sword ghost target joystick music headphones mic radio film clapperboard tv video
camera image brush palette pen-tool layout-template podcast users user-round user-plus hand
hand-heart baby bell circle-check triangle-alert circle-x clock calendar zap flame sparkles
flame-kindling sparkle gem sunrise shield life-buoy eye house inbox log-in link link-2
arrow-right arrow-left arrow-up arrow-down chevrons-right external-link map-pin compass
search list layout-grid rss mail coffee utensils pizza car bike plane ship dumbbell sun moon
leaf paw-print dog cat tree-pine flask-conical atom microscope stethoscope shirt folder
file-text paperclip scale landmark building-2 trash-2
`
    .trim()
    .split(/\s+/),
);
