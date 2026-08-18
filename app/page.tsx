import { FaqSchema } from "@/components/faq-schema";
import { MarketingFooter, MarketingHeader } from "@/components/marketing-chrome";
import { HomeCaseStudies } from "@/components/marketing/home-case-studies";
import { HomeHero } from "@/components/marketing/home-hero";
import {
  HomeAnnouncementBar,
  HomeBento,
  HomeCta,
  HomeFaq,
  HomeOldVsNew,
  HomePricingPreview,
  HomeSolutions,
  HomeSourceStrip,
  HomeStatsBand,
  HomeWorkflow,
} from "@/components/marketing/home-sections";
import { homeFaqs } from "@/lib/marketing-home-content";

export const dynamic = "force-static";

export default function Home() {
  return (
    <main className="min-h-screen bg-white text-[#425466]">
      <FaqSchema faqs={homeFaqs} />
      <HomeAnnouncementBar />
      <MarketingHeader />
      <HomeHero />
      <HomeSourceStrip />
      <HomeOldVsNew />
      <HomeWorkflow />
      <HomeBento />
      <HomeCaseStudies />
      <HomeStatsBand />
      <HomePricingPreview />
      <HomeSolutions />
      <HomeFaq />
      <HomeCta />
      <MarketingFooter />
    </main>
  );
}
