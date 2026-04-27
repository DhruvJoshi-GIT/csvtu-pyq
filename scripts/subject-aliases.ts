// Subject aliases — pin a real subject (source) into additional sem/branch
// slots so students who look in the wrong place still find it.
//
// The PDFs stay in their canonical folder; the alias is a virtual entry the
// build script clones into the destination sem. Both the listing page and
// the subject page work for the alias URL.
//
// `also_in` entries inherit the source's course/branch unless overridden,
// so most aliases are one line.

export type SubjectAlias = {
  source: {
    course: string;
    branch: string;
    sem: string;
    topic?: string;
    subject: string;
  };
  also_in: Array<{
    course?: string;
    branch?: string;
    sem: string;
    topic?: string;
  }>;
};

export const aliases: SubjectAlias[] = [
  {
    // Students often look for this in 8th sem; canonical scheme has it in 6th.
    source: { course: 'BTech', branch: 'ME', sem: 'Sem-6', subject: 'power-plant-engineering' },
    also_in: [{ sem: 'Sem-8' }],
  },
];
