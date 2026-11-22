/** NIP-05 file for free HandlePay names: /.well-known/nostr.json?name=alice */
import { handleNostrJson, preflight, type Env } from "../_lib/names";

export const onRequestGet = ({ request, env }: { request: Request; env: Env }) => handleNostrJson(request, env);
export const onRequestOptions = () => preflight();
