"use client";
import Image from "next/image";
export { ProductStory } from "./save-demo";

export function HeroIllustration() {
  return <div className="hero-art"><Image src="/stash-hero.webp" width={1000} height={985} alt="A folder holding saved references, links, and notes" sizes="(max-width: 560px) 320px, (max-width: 850px) 440px, 510px" preload /></div>;
}
