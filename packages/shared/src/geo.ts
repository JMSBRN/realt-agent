/**
 * География realt.by: области, областные центры и адреса страниц городов.
 *
 * Фильтр по месту на realt.by — параметр addressV2 со ссылкой на справочник сайта:
 *   {"stateRegionUuid": …} — вся область, {"townUuid": …} — город.
 * Без addressV2 сайт ищет по всей Беларуси.
 * uuid областей и областных центров взяты со страниц realt.by (октябрь 2026).
 * Для остальных городов uuid узнаём у самого сайта: открываем страницу города
 * (адрес строится по транслиту названия) и читаем фильтр из __NEXT_DATA__ — см. townPageUrls.
 */

/** Место поиска: название для людей и фильтр для realt.by (null — вся Беларусь). */
export interface Place {
  title: string;
  address: Record<string, string> | null;
}

export const BELARUS: Place = { title: "Беларусь", address: null };

interface Region {
  /** Корень названия для распознавания: «гомельская обл.», «Гомельщина». */
  stem: string;
  title: string;
  uuid: string;
  /** Префикс адресов страниц городов области на realt.by ("" — Минская область). */
  prefix: string;
  center: { title: string; stem: string; uuid: string };
  /** Транслиты городов области, у которых на realt.by есть свои страницы. */
  towns: string[];
}

export const REGIONS: Region[] = [
  {
    stem: "минск",
    title: "Минская область",
    uuid: "499f06b8-7b00-11eb-8943-0cc47adabd66",
    prefix: "",
    center: { title: "Минск", stem: "минск", uuid: "4cb07174-7b00-11eb-8943-0cc47adabd66" },
    towns: [
      "smolevichi", "borisov", "soligorsk", "zhodino", "molodechno", "sluck", "kopische", "machulischi", "fanipol",
      "ratomka", "marina-gorka", "vilejka", "dzerzhinsk", "novosele", "logojsk", "nesvizh", "lesnoj", "naroch",
      "stolbcy", "borovljany", "chist", "kolodischi", "sloboda", "zaslavl", "zhdanovichi", "mjadel", "priluki",
      "volozhin", "loshnica", "senica", "krupki", "gorodeja", "kleck", "uzda", "druzhnyj", "ljuban", "starye-dorogi",
      "cherven", "zareche", "pleschenicy", "zelenyj-bor", "berezino", "kopyl", "novokolosovo", "krasnaja-sloboda",
      "jubilejnyj", "gatovo", "radoshkovichi", "energetikov", "berezinskoe", "mihanovichi", "starobin", "ureche",
      "usjazh", "stankovo", "bolshoj-trostenec", "pravdinskij", "gacuk", "korolevo", "bogatyrevo", "negoreloe",
      "ostroshickij-gorodok", "petrishki", "ivenec", "marino", "rakov", "rudensk", "samohvalovichi", "turec-bojary",
      "bolshevik", "dukora", "leskovka", "neman", "partizanskij", "puhovichi", "semkovo", "snov", "hatezhino",
      "chernickij",
    ],
  },
  {
    stem: "брест",
    title: "Брестская область",
    uuid: "499ef96d-7b00-11eb-8943-0cc47adabd66",
    prefix: "/brest-region",
    center: { title: "Брест", stem: "брест", uuid: "4c8f8db2-7b00-11eb-8943-0cc47adabd66" },
    towns: [
      "baranovichi", "bereza", "drogichin", "gancevichi", "ivacevichi", "ivanovo", "kamenec", "kobrin", "ljahovichi",
      "luninec", "malorita", "pinsk", "pruzhany", "stolin", "zhabinka",
    ],
  },
  {
    stem: "витеб",
    title: "Витебская область",
    uuid: "499eff50-7b00-11eb-8943-0cc47adabd66",
    prefix: "/vitebsk-region",
    center: { title: "Витебск", stem: "витебск", uuid: "4c9236d8-7b00-11eb-8943-0cc47adabd66" },
    towns: [
      "beshenkovichi", "braslav", "chashniki", "dokshicy", "dubrovno", "glubokoe", "gorodok", "lepel", "liozno", "miory",
      "novolukoml", "novopolock", "orsha", "polock", "postavy", "rossony", "senno", "sharkovschina", "shumilino",
      "tolochin", "ushachi", "verhnedvinsk",
    ],
  },
  {
    stem: "гомел",
    title: "Гомельская область",
    uuid: "499f02f0-7b00-11eb-8943-0cc47adabd66",
    prefix: "/gomel-region",
    center: { title: "Гомель", stem: "гомел", uuid: "4c95d414-7b00-11eb-8943-0cc47adabd66" },
    towns: [
      "bragin", "buda-koshelevo", "chechersk", "dobrush", "elsk", "hojniki", "kalinkovichi", "korma", "lelchicy", "loev",
      "mozyr", "narovlja", "petrikov", "rechica", "rogachev", "svetlogorsk", "vetka", "zhitkovichi", "zhlobin",
    ],
  },
  {
    stem: "гродн",
    title: "Гродненская область",
    uuid: "499f04f0-7b00-11eb-8943-0cc47adabd66",
    prefix: "/grodno-region",
    center: { title: "Гродно", stem: "гродн", uuid: "4c97eac6-7b00-11eb-8943-0cc47adabd66" },
    towns: [
      "berestovica", "berezovka", "djatlovo", "ive", "lida", "mosty", "novogrudok", "oshmjany", "ostrovec", "schuchin",
      "skidel", "slonim", "smorgon", "svisloch", "volkovysk", "zelva",
    ],
  },
  {
    stem: "могил",
    title: "Могилевская область",
    uuid: "499f085c-7b00-11eb-8943-0cc47adabd66",
    prefix: "/mogilev-region",
    center: { title: "Могилев", stem: "могил", uuid: "4cb0e950-7b00-11eb-8943-0cc47adabd66" },
    towns: [
      "bobrujsk", "byhov", "chausy", "cherikov", "glusk", "gorki", "klichev", "klimovichi", "kostjukovichi", "krichev",
      "krugloe", "mstislavl", "osipovichi", "shklov", "slavgorod",
    ],
  },
];

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "j", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "",
  ы: "y", ь: "", э: "e", ю: "ju", я: "ja", і: "i", ў: "u",
};

/** Транслит, которым realt.by строит адреса страниц: «Буда-Кошелёво» → buda-koshelevo, «Слуцк» → sluck. */
export function realtTranslit(name: string): string {
  return [...name.toLowerCase().trim()]
    .map((ch) => TRANSLIT[ch] ?? (/[a-z0-9]/.test(ch) ? ch : "-"))
    .join("")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** «г. Гомель», «в городе Гомеле» → «гомель»; «Гомельская обл.» → «гомельская область». */
export function normalizePlace(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/(^|\s)обл\.?(?=\s|$)/g, "$1область")
    .replace(/^(в|во|на)\s+/, "")
    .replace(/^(г\.|г |город|городе|гор\.)\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const isCountry = (n: string) => /^(вся |по всей )?(беларус|белорус|рб$|страна|по стране)/.test(n);
const isRegionName = (n: string) => /(област|обл$|щина$)/.test(n);

/** Область по названию: «Гомельская», «гомельская область», «Гомельщина». */
export function findRegion(name: string | null | undefined): Region | null {
  if (!name) return null;
  const n = normalizePlace(name);
  return REGIONS.find((r) => n.startsWith(r.stem)) ?? null;
}

/**
 * Место, которое известно без обращения к сайту: страна, область, областной центр.
 * Остальные города — null: их адрес узнаём через townPageUrls.
 */
export function knownPlace(name: string | null | undefined): Place | null {
  if (!name || !name.trim()) return BELARUS;
  const n = normalizePlace(name);
  if (isCountry(n)) return BELARUS;
  const region = REGIONS.find((r) => n.startsWith(r.stem));
  if (region && isRegionName(n)) return { title: region.title, address: { stateRegionUuid: region.uuid } };
  // Падежи центров: «Гомеле», «Бресте», «Гродно», «Могилёве»
  const center = REGIONS.find((r) => n.startsWith(r.center.stem) && n.length <= r.center.title.length + 2);
  if (center) return { title: center.center.title, address: { townUuid: center.center.uuid } };
  return null;
}

/**
 * Страницы города на realt.by, по которым сайт сам скажет его uuid.
 * Если известна область — одна страница, иначе — по всем областям (первой — та, в списке которой город есть).
 *   Минская область: /sale/flats/<город>/
 *   Остальные:       /<область>-region/sale/flats/<город>/
 */
export function townPageUrls(town: string, regionName?: string | null): string[] {
  const slug = realtTranslit(normalizePlace(town));
  if (!slug) return [];
  const url = (r: Region) => `https://realt.by${r.prefix}/sale/flats/${slug}/`;
  const region = findRegion(regionName);
  if (region) return [url(region)];
  const listed = REGIONS.filter((r) => r.towns.includes(slug));
  return [...new Set([...listed, ...REGIONS].map(url))];
}

/** Область города, если её можно узнать без сайта: областной центр или город из списков выше. */
export function townRegion(town: string): string | null {
  const n = normalizePlace(town);
  const center = REGIONS.find((r) => n.startsWith(r.center.stem) && n.length <= r.center.title.length + 2);
  if (center) return center.title;
  const slug = realtTranslit(n);
  return REGIONS.find((r) => r.towns.includes(slug))?.title ?? null;
}

/** Адрес страницы города: для областного центра — со своей областью, а не первой попавшейся. */
export function townPageUrl(town: string, regionName?: string | null): string | null {
  const n = normalizePlace(town);
  const center = REGIONS.find((r) => n.startsWith(r.center.stem) && n.length <= r.center.title.length + 2);
  const name = center ? center.center.title : town;
  return townPageUrls(name, regionName ?? townRegion(town))[0] ?? null;
}
