/**
 * USSD screens. Keep every screen under ~160 characters (the smallest
 * handsets show about that much).
 *
 * HAUSA IS A DRAFT. It must be reviewed by a native speaker before
 * USSD_LANGUAGES includes "ha"; until then only English is offered.
 */
export type UssdLanguage = "en" | "ha";

export interface UssdText {
  main: string;
  confirm: string;
  cancelled: string;
  notRegistered: string;
  alreadyActive: string;
  where: (places: string[]) => string;
  landmark: string;
  canCall: string;
  done: string;
  doneNoCall: string;
  language: string;
  languageSaved: string;
  unavailable: string;
  invalid: string;
}

const en: UssdText = {
  main: "OPA\n1 Send SOS\n2 Language",
  confirm: "Send SOS now?\n1 Yes, send\n2 Cancel",
  cancelled: "Cancelled. No alert was sent.",
  notRegistered: "This number is not registered with OPA. Ask your estate or community administrator to register you.",
  alreadyActive: "Your alert is already active. Help has been notified.",
  where: (places) => ["SOS sent. Where are you?", ...places.map((p, i) => `${i + 1} ${p}`), "9 Somewhere else", "0 Skip"].join("\n"),
  landmark: "Type a landmark, e.g. near Kofar Mata mosque (0 to skip)",
  canCall: "Can security call you?\n1 Yes\n2 No, I can't talk",
  done: "Help is being alerted. Stay safe.",
  doneNoCall: "Help is being alerted. They will not call you. Stay safe.",
  language: "Language\n1 English\n2 Hausa",
  languageSaved: "Language saved.",
  unavailable: "OPA SOS by USSD is not available yet. If you can, use the OPA app.",
  invalid: "Invalid choice. Dial again.",
};

// DRAFT, pending native-speaker review.
const ha: UssdText = {
  main: "OPA\n1 Aika SOS\n2 Harshe",
  confirm: "Aika SOS yanzu?\n1 Eh, aika\n2 Soke",
  cancelled: "An soke. Ba a aika sanarwa ba.",
  notRegistered: "Ba a yi rajistar wannan lambar a OPA ba. Ka tambayi shugaban unguwarku ya yi maka rajista.",
  alreadyActive: "Sanarwarka tana aiki. An sanar da masu taimako.",
  where: (places) => ["An aika SOS. Ina kake?", ...places.map((p, i) => `${i + 1} ${p}`), "9 Wani wuri", "0 Tsallake"].join("\n"),
  landmark: "Rubuta wata alama, misali kusa da masallacin Kofar Mata (0 don tsallakewa)",
  canCall: "Jami'an tsaro za su iya kiran ka?\n1 Eh\n2 A'a, ba zan iya magana ba",
  done: "Ana sanar da masu taimako. Ka kasance lafiya.",
  doneNoCall: "Ana sanar da masu taimako. Ba za su kira ka ba. Ka kasance lafiya.",
  language: "Harshe\n1 Turanci\n2 Hausa",
  languageSaved: "An adana harshe.",
  unavailable: "Babu OPA SOS ta USSD tukuna. Idan za ka iya, yi amfani da manhajar OPA.",
  invalid: "Zabi mara kyau. Sake bugawa.",
};

export const USSD_TEXT: Record<UssdLanguage, UssdText> = { en, ha };

export function enabledLanguages(): UssdLanguage[] {
  const list = (process.env.USSD_LANGUAGES ?? "en").split(",").map((s) => s.trim());
  return (["en", "ha"] as UssdLanguage[]).filter((l) => l === "en" || list.includes(l));
}
