import { describe, expect, it } from "vitest";
import { renderProfileCard, renderTaskCard } from "./share-card";

describe("share-card: SVG output", () => {
  it("renders a well-formed profile SVG", () => {
    const svg = renderProfileCard({
      stakeAddress: "stake1u9abcdefghijklmnopqrstuvwxyz0123456789ab",
      points: 1234,
      rank: 7,
      verified: 12,
      projectsEngaged: 4,
    });
    expect(svg).toMatch(/^<\?xml version="1.0"/);
    expect(svg).toContain("Rank #7");
    expect(svg).toContain("1234");
    expect(svg).toContain("Verified tasks");
  });

  it("escapes XML metacharacters in user-supplied strings", () => {
    const svg = renderTaskCard({
      projectName: "Min<swap> & co",
      taskTitle: 'Vote "yes"',
      points: 100,
    });
    // Eyebrow uppercases the raw text then escapes — entity names stay
    // lower-case (XML spec requires).
    expect(svg).toContain("MIN&lt;SWAP&gt; &amp; CO");
    expect(svg).toContain("Vote &quot;yes&quot;");
    // Sanity: no raw '<' inside text nodes for the escaped content.
    expect(svg).not.toContain("Min<swap>");
  });

  it("handles missing rank gracefully", () => {
    const svg = renderProfileCard({
      stakeAddress: "stake1xyz",
      points: 0,
      verified: 0,
      projectsEngaged: 0,
    });
    expect(svg).toContain("Cardano leaderboard player");
  });
});
