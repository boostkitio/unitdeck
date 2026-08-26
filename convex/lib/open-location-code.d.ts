/**
 * Types for `open-location-code`, which ships plain JavaScript and no
 * declarations of its own.
 *
 * Only the surface this project uses is declared. `encode` is the whole of it:
 * shortening is done by dropping four leading characters (see plusCode.ts),
 * not by the library's `shorten`, so the rest of the API stays undeclared
 * rather than being described inaccurately.
 */
declare module "open-location-code" {
  export class OpenLocationCode {
    /**
     * A full Open Location Code for a point. `codeLength` defaults to 10,
     * which places the separator after eight digits and resolves to roughly
     * 13.5 metres.
     */
    encode(latitude: number, longitude: number, codeLength?: number): string;
  }
}
