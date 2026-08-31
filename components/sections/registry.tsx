import type { LandingContent, Section } from '@/lib/content/types'

import { HeroSection } from './HeroSection'
import {
  FeaturesSection,
  IntroSection,
  LinksSection,
  MediaSection,
  SocialSection,
  StatusSection,
  UpdatesSection,
  VideoSection,
} from './ContentSections'

/**
 * The landing page's composition system.
 *
 * `renderSection` maps one configured block to its component. The page itself
 * is then a sorted map over `content.sections` and nothing else, so:
 *
 *   - reordering the landing page is an `order` change in sections.json
 *   - turning a block off is `published: false`
 *   - adding a NEW block type is one entry in `lib/content/types.ts`
 *     (SECTION_TYPES + a config type), one component, and one case here
 *
 * The switch is exhaustive over the discriminated `Section` union, so a new
 * section type that is not handled is a COMPILE ERROR rather than a block that
 * silently renders nothing. That is the whole reason `Section` is a union keyed
 * on `type` instead of a bag with a string field.
 */

export function renderSection(section: Section, content: LandingContent) {
  switch (section.type) {
    case 'hero':
      return (
        <HeroSection
          key={section.id}
          config={section.config}
          settings={content.settings}
          links={content.links}
        />
      )

    case 'intro':
      return <IntroSection key={section.id} id={section.id} config={section.config} />

    case 'video':
      return (
        <VideoSection
          key={section.id}
          id={section.id}
          config={section.config}
          videos={content.videos}
        />
      )

    case 'media':
      return (
        <MediaSection
          key={section.id}
          id={section.id}
          config={section.config}
          media={content.media}
        />
      )

    case 'status':
      return <StatusSection key={section.id} id={section.id} config={section.config} />

    case 'features':
      return <FeaturesSection key={section.id} id={section.id} config={section.config} />

    case 'updates':
      return (
        <UpdatesSection
          key={section.id}
          id={section.id}
          config={section.config}
          updates={content.updates}
        />
      )

    case 'links':
      return (
        <LinksSection
          key={section.id}
          id={section.id}
          config={section.config}
          links={content.links}
          settings={content.settings}
        />
      )

    case 'social':
      return (
        <SocialSection
          key={section.id}
          id={section.id}
          config={section.config}
          settings={content.settings}
        />
      )

    default: {
      // Exhaustiveness check. If this stops compiling, a section type was added
      // to the union without a case above.
      const unhandled: never = section
      void unhandled
      return null
    }
  }
}
