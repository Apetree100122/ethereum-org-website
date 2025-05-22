import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import i18nConfig from "../../../i18n.config.json";
import crypto from "crypto";

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const secret = searchParams.get("secret");

  // Secret validation with timing-safe comparison
  const storedSecret = process.env.REVALIDATE_SECRET || "";
  const providedSecret = secret || "";
  let isValidSecret = false;
  try {
    isValidSecret =
      providedSecret.length === storedSecret.length &&
      crypto.timingSafeEqual(
        Buffer.from(providedSecret),
        Buffer.from(storedSecret)
      );
  } catch {
    isValidSecret = false;
  }
  if (!isValidSecret) {
    return NextResponse.json({ message: "Invalid secret" }, { status: 401 });
  }

  const BUILD_LOCALES = process.env.NEXT_PUBLIC_BUILD_LOCALES;
  const locales = BUILD_LOCALES
    ? BUILD_LOCALES.split(",")
    : (Array.isArray(i18nConfig) ? i18nConfig.map(({ code }) => code) : []);

  const path = searchParams.get("path");

  // Path validation and sanitization
  if (
    !path ||
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.includes("..") ||
    path.includes("//") ||
    path.length > 2048 // Prevent abnormally large inputs
  ) {
    return NextResponse.json({ message: "Invalid path provided" }, { status: 400 });
  }

  // Optionally, allow only certain characters in paths (tighten as needed)
  // if (!/^\/[a-zA-Z0-9\-_/]*$/.test(path)) {
  //   return NextResponse.json({ message: "Invalid path characters" }, { status: 400 });
  // }

  if (process.env.NODE_ENV !== "production") {
    console.log("Revalidating", path);
  }

  try {
    const hasLocaleInPath = locales.some((locale) =>
      path.startsWith(`/${locale}/`)
    );

    if (hasLocaleInPath) {
      await revalidatePath(path);
    } else {
      // First revalidate the default locale to cache the results
      await revalidatePath(`/en${path}`);

      // Then revalidate all other locales
      await Promise.all(
        locales.map(async (locale) => {
          const localePath = `/${locale}${path}`;
          if (process.env.NODE_ENV !== "production") {
            console.log(`Revalidating ${localePath}`);
          }
          try {
            await revalidatePath(localePath);
          } catch (err) {
            if (process.env.NODE_ENV !== "production") {
              console.error(`Error revalidating ${localePath}`);
            }
            // Do not leak error details to clients
            throw new Error("Error revalidating path");
          }
        })
      );
    }

    return NextResponse.json({ revalidated: true });
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Revalidation error", err);
    }
    return NextResponse.json({ message: "Error revalidating" }, { status: 500 });
  }
}
