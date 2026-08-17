const organization = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Discover Keywords",
  url: "https://discoverkeywords.co",
  email: "support@discoverkeywords.co",
};

const software = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Discover Keywords",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  url: "https://discoverkeywords.co",
  offers: {
    "@type": "Offer",
    price: "49.00",
    priceCurrency: "USD",
    description: "Founding Member monthly subscription. Price includes applicable tax.",
  },
};

export function ProductJsonLd() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organization) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(software) }} />
    </>
  );
}
