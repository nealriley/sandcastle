import Image from "next/image";
import Link from "next/link";

type BrandLogoVariant = "header" | "hero" | "signin";

const logoVariants: Record<
  BrandLogoVariant,
  { src: string; width: number; height: number }
> = {
  header: {
    src: "/brand/sandcastle-logo-header.png",
    width: 44,
    height: 44,
  },
  hero: {
    src: "/brand/sandcastle-logo-hero.png",
    width: 320,
    height: 320,
  },
  signin: {
    src: "/brand/sandcastle-logo-hero.png",
    width: 220,
    height: 220,
  },
};

function buildClassName(
  variant: BrandLogoVariant,
  className?: string
): string {
  return ["brand-logo", `brand-logo--${variant}`, className]
    .filter(Boolean)
    .join(" ");
}

export default function BrandLogo({
  variant = "header",
  href,
  priority = false,
  className,
}: {
  variant?: BrandLogoVariant;
  href?: string;
  priority?: boolean;
  className?: string;
}) {
  const logo = logoVariants[variant];
  const image = (
    <Image
      src={logo.src}
      alt="Sandcastle logo"
      width={logo.width}
      height={logo.height}
      priority={priority}
      className={buildClassName(variant, className)}
    />
  );

  if (!href) {
    return image;
  }

  return (
    <Link href={href} aria-label="Sandcastle" className="brand brand--logo-only">
      {image}
    </Link>
  );
}
