/** Claim, release and look up free HandlePay names. See functions/_lib/names.ts. */
import { handleAvailability, handleNamesPost, preflight, type Env } from "../_lib/names";

export const onRequestGet = ({ request, env }: { request: Request; env: Env }) => handleAvailability(request, env);
export const onRequestPost = ({ request, env }: { request: Request; env: Env }) => handleNamesPost(request, env);
export const onRequestOptions = () => preflight();
