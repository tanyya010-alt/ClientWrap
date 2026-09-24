"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const CLIENT_FACING = ["/p/", "/pay/", "/u/", "/approve/", "/cs/"];

/** ClientWrap only sets strictly-necessary cookies (session, CSRF-safe OAuth state), so this is a notice, not a consent wall. */
export function CookieNotice() {
  const [show, setShow] = useState(false);
  const path = usePathname() ?? "";
  useEffect(() => {
    try {
      setShow(!localStorage.getItem("cw_cookie_notice"));
    } catch {
      setShow(false);
    }
  }, []);
  // Client-facing pages set no cookies at all, so no notice is needed there.
  if (!show || CLIENT_FACING.some((p) => path.startsWith(p))) return null;
  return (
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-lg sm:flex sm:items-center sm:gap-4">
      <p className="text-slate-700">
        We only use essential cookies to keep you signed in and secure. No tracking or ads.{" "}
        <a href="/legal/cookies" className="text-indigo-600 underline">
          Cookie notice
        </a>
      </p>
      <button
        className="mt-3 rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white sm:mt-0"
        onClick={() => {
          try {
            localStorage.setItem("cw_cookie_notice", "1");
          } catch {}
          setShow(false);
        }}
      >
        OK
      </button>
    </div>
  );
}
