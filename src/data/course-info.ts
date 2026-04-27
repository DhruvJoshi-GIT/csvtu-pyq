// Course and branch full names for CSVTU programs.
// Sourced from csvtu.ac.in/ew/programs-and-schemes/ (Apr 2026).

export const courseFullName: Record<string, string> = {
  BTech: 'Bachelor of Technology',
  Diploma: 'Diploma in Engineering',
  MBA: 'Master of Business Administration',
  MCA: 'Master of Computer Applications',
  MTech: 'Master of Technology',
  BCA: 'Bachelor of Computer Applications',
  BPharmacy: 'Bachelor of Pharmacy',
  DPharmacy: 'Diploma in Pharmacy',
  MPharmacy: 'Master of Pharmacy',
  BBA: 'Bachelor of Business Administration',
  BArchitecture: 'Bachelor of Architecture',
  BVocational: 'Bachelor of Vocational Studies',
  DVocational: 'Diploma in Vocational Studies',
  PhD: 'Doctor of Philosophy',
  PTDC: 'Part-Time Diploma Course',
};

// Branch / specialization full names. Keys match the branch codes used
// in folder structure.
export const branchFullName: Record<string, string> = {
  // BTech branches
  CSE: 'Computer Science & Engineering',
  IT: 'Information Technology',
  ME: 'Mechanical Engineering',
  CE: 'Civil Engineering',
  EE: 'Electrical Engineering',
  ET: 'Electronics & Telecommunication Engineering',
  BT: 'Biotechnology',
  EI: 'Electronics & Instrumentation Engineering',
  MI: 'Mining Engineering',
  MT: 'Metallurgical Engineering',

  // Diploma branches (some overlap, some unique)
  CS: 'Computer Science',
  EEE: 'Electrical & Electronics Engineering',
  IE: 'Industrial Electronics',
  MET: 'Metallurgy',
  MOM: 'Modern Office Management',

  // Catch-all
  Others: 'Other Specializations',
  '1st-Year': 'First Year (Shared across branches)',
};

export function describeCourse(name: string): string | undefined {
  return courseFullName[name];
}

export function describeBranch(name: string): string | undefined {
  if (name === '_') return undefined;
  return branchFullName[name];
}
