/**
 * Material Symbols (outlined, weight 400), bundled as inline SVG.
 *
 * Each icon is imported as text at build time, so only the icons listed here
 * reach the bundle (a few hundred bytes each). There is no icon font, no
 * network request and no flash of missing glyphs. The SVGs come from Google's
 * @material-symbols/svg-400 package, never from user input, so injecting them
 * is safe.
 *
 * An icon is decorative (hidden from screen readers) unless it is given a
 * `label`; every icon in the app sits next to words that say the same thing.
 */
import accountBalanceWallet from "@material-symbols/svg-400/outlined/account_balance_wallet.svg?raw";
import alternateEmail from "@material-symbols/svg-400/outlined/alternate_email.svg?raw";
import arrowForward from "@material-symbols/svg-400/outlined/arrow_forward.svg?raw";
import changeCircle from "@material-symbols/svg-400/outlined/change_circle.svg?raw";
import check from "@material-symbols/svg-400/outlined/check.svg?raw";
import checkCircle from "@material-symbols/svg-400/outlined/check_circle-fill.svg?raw";
import close from "@material-symbols/svg-400/outlined/close.svg?raw";
import cloudOff from "@material-symbols/svg-400/outlined/cloud_off.svg?raw";
import code from "@material-symbols/svg-400/outlined/code.svg?raw";
import contentCopy from "@material-symbols/svg-400/outlined/content_copy.svg?raw";
import devices from "@material-symbols/svg-400/outlined/devices.svg?raw";
import download from "@material-symbols/svg-400/outlined/download.svg?raw";
import extension from "@material-symbols/svg-400/outlined/extension.svg?raw";
import gppMaybe from "@material-symbols/svg-400/outlined/gpp_maybe.svg?raw";
import hourglassTop from "@material-symbols/svg-400/outlined/hourglass_top.svg?raw";
import howToVote from "@material-symbols/svg-400/outlined/how_to_vote.svg?raw";
import key from "@material-symbols/svg-400/outlined/key.svg?raw";
import keyboardArrowDown from "@material-symbols/svg-400/outlined/keyboard_arrow_down.svg?raw";
import linkOff from "@material-symbols/svg-400/outlined/link_off.svg?raw";
import lock from "@material-symbols/svg-400/outlined/lock.svg?raw";
import login from "@material-symbols/svg-400/outlined/login.svg?raw";
import noAccounts from "@material-symbols/svg-400/outlined/no_accounts.svg?raw";
import openInNew from "@material-symbols/svg-400/outlined/open_in_new.svg?raw";
import print from "@material-symbols/svg-400/outlined/print.svg?raw";
import qrCode from "@material-symbols/svg-400/outlined/qr_code_2.svg?raw";
import radioButtonUnchecked from "@material-symbols/svg-400/outlined/radio_button_unchecked.svg?raw";
import receiptLong from "@material-symbols/svg-400/outlined/receipt_long.svg?raw";
import searchOff from "@material-symbols/svg-400/outlined/search_off.svg?raw";
import send from "@material-symbols/svg-400/outlined/send.svg?raw";
import slideshow from "@material-symbols/svg-400/outlined/slideshow.svg?raw";
import uploadFile from "@material-symbols/svg-400/outlined/upload_file.svg?raw";
import verified from "@material-symbols/svg-400/outlined/verified.svg?raw";
import visibility from "@material-symbols/svg-400/outlined/visibility.svg?raw";

const RAW = {
  account_balance_wallet: accountBalanceWallet,
  alternate_email: alternateEmail,
  arrow_forward: arrowForward,
  change_circle: changeCircle,
  check,
  check_circle: checkCircle,
  close,
  cloud_off: cloudOff,
  code,
  content_copy: contentCopy,
  devices,
  download,
  expand_more: keyboardArrowDown,
  extension,
  gpp_maybe: gppMaybe,
  hourglass_top: hourglassTop,
  how_to_vote: howToVote,
  key,
  link_off: linkOff,
  lock,
  login,
  no_accounts: noAccounts,
  open_in_new: openInNew,
  print,
  qr_code: qrCode,
  radio_button_unchecked: radioButtonUnchecked,
  receipt_long: receiptLong,
  search_off: searchOff,
  send,
  slideshow,
  upload_file: uploadFile,
  verified,
  visibility,
};

export type IconName = keyof typeof RAW;

// The files say width="48" height="48"; drop that so CSS sizes the icon to the text around it.
const SVG = Object.fromEntries(
  Object.entries(RAW).map(([name, svg]) => [name, svg.replace(/\s(width|height)="\d+"/g, "")]),
) as Record<IconName, string>;

export function Icon({ name, label, className }: { name: IconName; label?: string; className?: string }) {
  return (
    <span
      className={`icon${className ? ` ${className}` : ""}`}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      dangerouslySetInnerHTML={{ __html: SVG[name] }}
    />
  );
}
