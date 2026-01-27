import "./index.css";
import UBCMap from "./UBCMap";

export default function App() {
  const openViewer = (path?: string, markers?: Array<Record<string, unknown>>) => {
    if (!path) return;
    const url = new URL("/viewer", window.location.href);
    url.searchParams.set("gaussianPath", path);
    if (markers && markers.length > 0) {
      url.searchParams.set("markers", JSON.stringify(markers));
    }
    window.open(url.href, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="app" style={{ minHeight: "100dvh" }}>
      <section style={{ display: "grid", placeItems: "center", padding: "3rem 1rem" }}>
        <div style={{ textAlign: "center", maxWidth: 520 }}>
          <h1 style={{ marginBottom: "1rem" }}>Virtual Soils</h1>
          <p style={{ margin: 0, lineHeight: 1.6, color: "#9aa4b5" }}>
            Browse the map below and select a field pin to launch its interactive 3D capture in a
            new tab.
          </p>
        </div>
      </section>

      <section style={{ padding: "0 1rem 2rem" }}>
        <div className="contentWidth">
          <UBCMap openViewer={openViewer} />
        </div>
      </section>

      {/* Info section */}
      <section className="mapInfo">
        <div
          className="contentWidth mapInfoInner"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(200px, 260px) 1fr",
            gap: "2rem",
            alignItems: "start",
          }}
        >
          {/* Left nav */}
          <aside style={{ position: "sticky", top: "1rem" }}>
            <h2 style={{ marginTop: 0 }}>Quickly Navigate</h2>
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <a href="#TheWhy" className="btn btn-sec-hov">
                Why Virtual Soils?
              </a>
              <a href="#TheWhat" className="btn btn-sec-hov">
                What are Radiance Fields?
              </a>
              <a href="#NextSteps" className="btn btn-sec-hov">
                Next Steps
              </a>
            </div>
          </aside>

          {/* Main content */}
          <article className="floatSection">
            {/* WHY */}
            <h2 id="TheWhy">Why Virtual Soils?</h2>

            <figure className="float-right">
              {}
              <img
                src="/assets/images/Canada-Soil-Map.jpg"
                alt="Soil Order Map of Canada"
                style={{ width: "100%", borderRadius: 6 }}
              />
              <figcaption style={{ opacity: 0.8, marginTop: ".5rem" }}>
                Soil Order Map of Canada from{" "}
                <a href="https://soilsofcanada.ca/" target="_blank" rel="noreferrer">
                  soilsofcanada.ca
                </a>
              </figcaption>
            </figure>

            <p>
              Soils are all around us. Whether we&apos;re in the city, or in the countryside there is
              soil somewhere near to us. In planters or parks, fields or forests. When teaching, or
              learning about soil finding it isn&apos;t the problem, the problem is accessing the{" "}
              <i>diversity</i>. As soil formation is impacted by the five soil formation factors{" "}
              <b>Cl</b>imate, <b>O</b>rganisms, <b>R</b>elief, <b>P</b>arent Material, and{" "}
              <b>T</b>ime (ClORPT), and these factors vary on the scale of landscapes. This leads to
              soils varying on the scale of landscapes, which therefore necessitates the need for a
              variety of tools to communicate about the diversity of soils.
            </p>

            <p>
              Within soil science there are already many powerful tools for education and
              communication. Photos, videos, physical and digital soil monoliths, field courses,
              conference presentations, and many more. They all have an important place, but
              Radiance Fields can add something more.
            </p>

            <p>
              Photos and videos of soil are above all else one of the most accessible forms for
              sharing soils. Photos and videos are ubiquitous in the world, and high quality photos
              of soil have never been as available as they are today. At times they can capture more
              detail than our eyes, and can be sent instantly across the world. The greatest
              strength of photos and videos though is their lack of interactivity: as viewers you
              cannot explore beyond the frame.
            </p>

            <figure className="float-left">
              <img
                src="/assets/images/Soil-Monolith.jpg"
                alt="Soil monolith photograph"
                style={{ width: "100%", borderRadius: 6 }}
              />
              <figcaption style={{ opacity: 0.8, marginTop: ".5rem" }}>
                A photograph of Monolith 8-04 from the UBC Soil Monolith Collection.
              </figcaption>
            </figure>

            <p>
              Soil monoliths are another excellent tool for soil science communication, and
              education. They can bring remote soils into classrooms, or museums for people to
              observe, and in some cases, interact with. However, they are limited by their cost of
              production, and delicate nature. This has been addressed by Krzic et al. with the
              creation of the Virtual Monolith Collection that first used photos of the monoliths
              (2010, 2013), and was later upgraded with{" "}
              <a href="https://sketchfab.com/krzic" target="_blank" rel="noreferrer">
                3D models available on SketchFab
              </a>{" "}
              (2020).
            </p>

            <p>
              Field courses are the final level, and gold standard of soil science education and
              communication. Experiencing the environment of soil allows for the greatest
              understanding of the context of the soil, and enables us to truly connect with the
              soil, and landscape. Field courses however are limited by physical access to remote
              locations, and complex logistics required to move large groups of people around.
            </p>

            <figure className="float-right">
              <img
                src="/assets/images/Radiance-Fields-Demo.jpg"
                alt="Radiance fields demo in VRChat"
                style={{ width: "100%", borderRadius: 6 }}
              />
              <figcaption style={{ opacity: 0.8, marginTop: ".5rem" }}>
                An example of how PC-VR based radiance fields have been used for soil science
                communication in VRChat.
              </figcaption>
            </figure>

            <p>
              Radiance fields for soil science are part of a novel opportunity to expand the tools
              available for soil science communication, and education. Building upon advancements
              in GPU compute power, machine learning, and 3D reconstruction, radiance fields using
              3D Gaussian splats allow for complete reconstructions of soils, and their surrounding
              environments. These reconstructed environments can build upon previous success with
              online soil education resources, such as the Virtual Monolith Collection, to create
              an online resource of soils, and their environmental contexts.
            </p>

            <p>
              The first step to implementing radiance fields in soil science is to create an
              accessible web experience which lets people view a wide range of soils. Researchers
              could share radiance fields of the soils they are working in, giving others a new
              level of capability for experiencing the environments that others are working with.
              Students can use it as a tool for learning, building soil ID skills, and an
              understanding of how soils, landscapes, and people are deeply intertwined.
            </p>

            <p>
              The next step is to create a desktop application &amp; PC-VR ready Virtual Soils
              application, that allows anyone with a VR ready PC to go and truly experience the
              soils. To meet with someone halfway across the world, and discuss “in the field”
              about the soils at their feet. To share knowledge, collaboratively, in a completely
              new way.
            </p>

            <h3>The Concept for PC-VR based Virtual Soils:</h3>
            <div style={{ width: "100%", aspectRatio: "16/9", borderRadius: 6, overflow: "hidden" }}>
              <iframe
                width="100%"
                height="100%"
                src="https://www.youtube-nocookie.com/embed/DNamuPJKqbQ?si=9gffCn_dsnjbC5yi&rel=0"
                title="Virtual Soils concept video"
                frameBorder={0}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            </div>

            {/* WHAT */}
            <h2 id="TheWhat" style={{ marginTop: "2.5rem" }}>
              What are Radiance Fields and Gaussian Splats?
            </h2>

            <figure className="float-left">
              <img
                src="/assets/images/Gaussian-Splat.jpg"
                alt="3D Gaussian splats example"
                style={{ width: "100%", borderRadius: 6 }}
              />
              <figcaption style={{ opacity: 0.8, marginTop: ".5rem" }}>
                A screenshot from the radiance field of the Ed Lyon Forest Garden on Sts&apos;ailes
                Territory showcasing individual 3D Gaussian Splats.
              </figcaption>
            </figure>

            <p>
              Radiance fields are a volumetric approach to the digital reconstruction of real-world
              environments, landscapes, and objects using photogrammetric methods, and techniques.
              Volumetric reconstructions apply clouds of many individual points to reconstruct
              objects, and spaces. This differs from mesh based reconstructions which use triangles,
              and 2D images for digital reconstructions.
            </p>

            <p>
              Research on volumetric reconstructions has had several large advancements in recent
              years, including work by{" "}
              <a href="https://www.matthewtancik.com/nerf" target="_blank" rel="noreferrer">
                Mildenhall et al. (2020)
              </a>{" "}
              which combined view dependent properties, and machine learning, and more recently 3D
              Gaussian splats by{" "}
              <a
                href="https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/"
                target="_blank"
                rel="noreferrer"
              >
                Kerbl et al. (2023)
              </a>{" "}
              which allow for the real-time rendering of Gaussian splats on a wide range of devices.
            </p>

            <p>
              3D Gaussian splats themselves are 3 dimensional points in space with properties for
              colour and transparency and spherical harmonics that contain view dependent
              properties, such as reflections. These points can be squashed and stretched, and
              added and removed as part of a machine learning process that iteratively refines the
              reconstruction.
            </p>

            <p>
              The radiance fields on this website currently utilise 3D Gaussian splats trained
              within{" "}
              <a
                href="https://github.com/MrNeRF/LichtFeld-Studio"
                target="_blank"
                rel="noreferrer"
              >
                Lichtfeld Studio
              </a>{" "}
              on a Nvidia RTX 3080 10GB after capture on either an iPhone 13 or a{" "}
              <a
                href="https://www.sony.ca/en/interchangeable-lens-cameras/products/zv-e10"
                target="_blank"
                rel="noreferrer"
              >
                Sony Alpha ZV-E10
              </a>{" "}
              with{" "}
              <a
                href="https://www.sony.ca/en/lenses/products/selp1020g"
                target="_blank"
                rel="noreferrer"
              >
                Sony E PZ 10-20mm F4 G
              </a>
              . Radiance fields however can be captured on nearly any device with great success.
            </p>

            <p>
              Currently, 3D Gaussian splat based radiance fields are rendered within a WebGL 3D
              Viewer created by{" "}
              <a href="https://github.com/mkkellogg" target="_blank" rel="noreferrer">
                Mark Kellog
              </a>
              .
            </p>

            {/* NEXT STEPS */}
            <h2 id="NextSteps" style={{ marginTop: "2.5rem" }}>
              Project Next Steps
            </h2>

            <figure className="float-right">
              <img
                src="assets/images/Capture-Aids.jpg"
                alt="Capture aids with AprilTags"
                style={{ width: "100%", borderRadius: 6 }}
              />
              <figcaption style={{ opacity: 0.8, marginTop: ".5rem" }}>
                A screenshot of the tracking soil tape, and scale flags used in the capture of the
                Totem Field radiance field! These capture aids used 36h11 AprilTags by{" "}
                <a href="https://github.com/AprilRobotics/apriltag" target="_blank" rel="noreferrer">
                  AprilRobotics
                </a>
                .
              </figcaption>
            </figure>

            <p>
              Current work on the Virtual Soils project is focusing on ways to enhance the web
              viewer experience, with the objective of making the project more interactive, and
              scalable to a much larger extent. This work is being done in collaboration with the{" "}
              <a href="https://eml.ubc.ca/" target="_blank" rel="noreferrer">
                UBC Emerging Media Lab
              </a>{" "}
              as part of a Small Teaching and Learning Enhancement Fund project.
            </p>

            <p>
              Future work on this project will include (1) further validation of the capture
              method, (2) the publishing of the method and associated resources as an open-access
              academic paper, (3) the application of these reconstructed environments and soils for
              soil science education and science communication and more!
            </p>

            <p>
              If you want to get in contact about the Virtual Soils project please email{" "}
              <a href="mailto:amy.wells@virtualsoils.ca">amy.wells@virtualsoils.ca</a>!
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
