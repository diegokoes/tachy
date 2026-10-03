import type { IconName } from "../tui/icons";

/**
 * ADO's stock work item type glyphs, by id, onto the app's own marks. The
 * icon URL ADO hands out needs the PAT to load, so it is never fetched; an id
 * with no counterpart here gets the generic mark.
 */
const BY_ID: Record<string, IconName> = {
  icon_insect: "bug",
  icon_clipboard: "wiTask",
  icon_book: "wiStory",
  icon_crown: "wiEpic",
  icon_trophy: "wiFeature",
  icon_list: "wiBacklog",
  icon_check_box: "wiCheck",
  icon_star: "wiStar",
  icon_diamond: "wiDiamond",
  icon_gift: "wiGift",
  icon_gavel: "wiGavel",
  icon_chat_bubble: "wiChat",
  icon_flame: "wiFlame",
  icon_traffic_cone: "wiCone",
  icon_car: "wiCar",
  icon_airplane: "wiPlane",
  icon_key: "wiKey",
  icon_megaphone: "wiMegaphone",
  icon_palette: "wiPalette",
  icon_government: "wiLandmark",
  icon_asterisk: "wiAsterisk",
  icon_headphone: "wiHeadphones",
  icon_sticky_note: "wiNote",
  icon_code_review: "wiCode",
  icon_code_response: "wiCode",
  icon_database_storage: "wiDatabase",
  icon_test_beaker: "wiTest",
};

export const typeIcon = (id: string | null | undefined): IconName =>
  (id && BY_ID[id]) || "wiGeneric";

/** ADO sends `CC293D`; a malformed one is dropped rather than injected into CSS. */
export const typeColor = (hex: string | null | undefined): string | null =>
  hex && /^[0-9a-f]{6}$/i.test(hex) ? `#${hex}` : null;
