import { ImageResponse } from "next/og";

export const alt = "Library of Babel — Personal Shelf Catalogue";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#f6efd9",
          padding: "36px",
          fontFamily: "Georgia, 'Times New Roman', serif",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            padding: "12px",
            border: "4px solid #284d43",
            backgroundColor: "#f6efd9",
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              border: "2px solid #6b1d28",
              padding: "48px 64px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 22,
                letterSpacing: "0.28em",
                color: "#6b1d28",
                textTransform: "uppercase",
                marginBottom: "28px",
              }}
            >
              PRINTED FOR PRIVATE CIRCULATION
            </div>

            <div
              style={{
                display: "flex",
                width: "120px",
                height: "2px",
                backgroundColor: "#284d43",
                marginBottom: "32px",
              }}
            />

            <div
              style={{
                display: "flex",
                fontSize: 84,
                fontWeight: 700,
                color: "#284d43",
                letterSpacing: "-0.01em",
                lineHeight: 1.08,
                marginBottom: "28px",
              }}
            >
              Library of Babel
            </div>

            <div
              style={{
                display: "flex",
                width: "220px",
                height: "2px",
                backgroundColor: "#6b1d28",
                marginBottom: "28px",
              }}
            />

            <div
              style={{
                display: "flex",
                fontSize: 28,
                color: "#2f3e39",
                letterSpacing: "0.06em",
              }}
            >
              Shelf Catalogue · Commonplace Book · Reading Ledger
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
