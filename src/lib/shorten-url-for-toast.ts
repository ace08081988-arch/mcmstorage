// Pratinjau URL panjang untuk toast: buang skema (http/https), lalu jika
// masih > max char potong tengahnya dengan ellipsis supaya host + ekor
// query tetap terlihat — yang paling berguna untuk verifikasi cepat.
export function shortenUrlForToast(url: string, max = 56): string {
  const stripped = url.replace(/^https?:\/\//, "");
  if (stripped.length <= max) return stripped;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${stripped.slice(0, head)}…${stripped.slice(-tail)}`;
}
