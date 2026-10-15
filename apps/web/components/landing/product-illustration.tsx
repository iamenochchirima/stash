"use client";
import Image from "next/image";
import { FileText, List, Image as ImageIcon, Code2 } from "lucide-react";
export { ProductStory } from "./save-demo";

const assistants = [
  {
    name: "ChatGPT",
    logo: "/agents/chatgpt.svg",
    detail: "Articles · Ideas · Notes",
    color: "#12bc91",
    icon: FileText,
    path: "M200 50 C200 155 295 70 355 150 S430 180 500 230",
    mobile: "M80 65 C80 135 155 110 200 210",
  },
  {
    name: "Claude",
    logo: "/agents/claude.png",
    detail: "Research · Summaries · Insights",
    color: "#ff9948",
    icon: FileText,
    path: "M900 50 C900 160 800 70 745 150 S670 180 600 230",
    mobile: "M320 65 C320 135 245 110 200 210",
  },
  {
    name: "Lina",
    logo: "/agents/lina.png",
    detail: "Plans · Tasks · Learnings",
    color: "#9860fc",
    icon: List,
    path: "M200 280 C295 320 320 230 385 240 S435 260 500 280",
    mobile: "M80 335 C80 280 150 300 200 210",
  },
  {
    name: "Gemini",
    logo: "/agents/gemini.png",
    detail: "Web · References · Media",
    color: "#399eff",
    icon: ImageIcon,
    path: "M900 280 C805 340 780 245 715 260 S650 260 600 280",
    mobile: "M320 335 C320 280 250 300 200 210",
  },
  {
    name: "Grok",
    logo: "/agents/grok.svg",
    detail: "Trends · Discussions · Ideas",
    color: "#84909e",
    icon: Code2,
    path: "M550 470 C450 410 630 395 550 330",
    mobile: "M200 445 C145 380 255 360 200 260",
  },
];

function Streams({ mobile = false }: { mobile?: boolean }) {
  return (
    <svg
      className={`network-streams ${mobile ? "network-mobile" : "network-desktop"}`}
      viewBox={mobile ? "0 0 400 470" : "0 0 1100 500"}
      fill="none"
      aria-hidden="true"
    >
      {assistants.map((agent, index) => {
        const path = mobile ? agent.mobile : agent.path;
        const Icon = agent.icon;
        return (
          <g
            key={agent.name}
            style={{ "--stream-color": agent.color } as React.CSSProperties}
          >
            <path
              d={path}
              stroke={agent.color}
              strokeWidth={mobile ? 22 : 30}
              opacity=".035"
            />
            <path
              d={path}
              stroke={agent.color}
              strokeWidth="1.5"
              strokeDasharray="6 8"
              opacity=".6"
            />
            {[0, 1].map((particle) => (
              <circle
                key={particle}
                className="network-particle"
                r={particle ? 3 : 5}
                fill={agent.color}
              >
                <animateMotion
                  dur="5s"
                  begin={`${-index - particle * 2.5}s`}
                  repeatCount="indefinite"
                  path={path}
                />
              </circle>
            ))}
            <g
              className="network-packet"
              style={{ animationDelay: `${-index}s` }}
            >
              <animateMotion
                dur="5s"
                begin={`${-index}s`}
                repeatCount="indefinite"
                path={path}
              />
              <rect
                x="-19"
                y="-21"
                width="38"
                height="42"
                rx="12"
                fill="white"
                stroke={agent.color}
                strokeOpacity=".16"
              />
              <Icon
                x={-10}
                y={-11}
                width={20}
                height={22}
                stroke={agent.color}
                strokeWidth={1.6}
              />
            </g>
          </g>
        );
      })}
    </svg>
  );
}

export function HeroIllustration() {
  return (
    <div
      className="hero-network-art"
      role="img"
      aria-label="Articles, ideas and notes from your AI assistants flowing into your Stash library"
    >
      <div className="network-halo" aria-hidden="true" />
      <Streams />
      <Streams mobile />
      {assistants.map((agent) => (
        <div
          key={agent.name}
          className={`network-agent network-${agent.name.toLowerCase()}`}
          style={{ "--stream-color": agent.color } as React.CSSProperties}
          aria-hidden="true"
        >
          <span className="network-logo">
            <img src={agent.logo} width={44} height={44} alt="" />
          </span>
          <span>
            <strong>{agent.name}</strong>
            <small>{agent.detail}</small>
          </span>
        </div>
      ))}
      <div className="network-folder">
        <Image
          src="/stash-hero.webp"
          width={1000}
          height={985}
          alt=""
          sizes="(max-width: 560px) 210px, 320px"
          preload
        />
      </div>
      <div className="network-note network-note-left" aria-hidden="true">
        From conversation
        <br />
        to your library
        <svg viewBox="0 0 100 50">
          <path d="M5 15 Q45 65 85 8 M72 12 L85 8 L82 23" />
        </svg>
      </div>
      <div className="network-note network-note-right" aria-hidden="true">
        <svg viewBox="0 0 100 50">
          <path d="M95 40 Q45 45 20 5 M18 19 L20 5 L32 13" />
        </svg>
        Knowledge that
        <br />
        stays with you
      </div>
    </div>
  );
}
