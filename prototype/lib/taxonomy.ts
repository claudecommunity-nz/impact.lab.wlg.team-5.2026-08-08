// Issue taxonomy.
//
// The `business as usual` services mirror the categories the Council's existing
// public reporting tool (FIXiT, services.wellington.govt.nz/report) offers
// today, so this prototype reads as an extension of the channel residents
// already know rather than a replacement for it.
//
// The `emergency` service is the new branch. Nothing in the current taxonomy
// covers flooding, slips, blocked roads or people needing help — today those
// route to a phone number and no further.

export interface Fault {
  id: string
  label: string
}

export interface Service {
  id: string
  label: string
  blurb: string
  emergency?: boolean
  faults: Fault[]
}

export const EMERGENCY = 'emergency'

export const SERVICES: Service[] = [
  {
    id: EMERGENCY,
    label: 'Emergency or storm impact',
    blurb: 'Local conditions during or after an event — flooding, slips, blocked roads, services out.',
    emergency: true,
    faults: [
      { id: 'flooding', label: 'Surface flooding' },
      { id: 'slip', label: 'Slip or landslide' },
      { id: 'road-blocked', label: 'Road blocked or impassable' },
      { id: 'tree-down', label: 'Tree or large debris down' },
      { id: 'building-damage', label: 'Damage to a building or structure' },
      { id: 'power-out', label: 'Power out' },
      { id: 'water-out', label: 'No water, or water main burst' },
      { id: 'coastal', label: 'Coastal inundation or wave overtopping' },
      { id: 'access-cut', label: 'Properties cut off / no access' },
      { id: 'assistance', label: 'People needing assistance' },
      { id: 'hub-status', label: 'Community Emergency Hub status update' },
    ],
  },
  {
    id: 'roads',
    label: 'Roads, traffic or footpaths',
    blurb: 'Potholes, damaged surfaces, footpath faults.',
    faults: [
      { id: 'pothole', label: 'Pothole' },
      { id: 'road-damage', label: 'Damage to a road' },
      { id: 'uneven-surface', label: 'Uneven or slippery surface' },
      { id: 'footpath', label: 'Footpath fault' },
      { id: 'drain', label: 'Slot or strip drain' },
      { id: 'speed-hump', label: 'Speed hump' },
    ],
  },
  {
    id: 'street-cleaning',
    label: 'Street cleaning or vegetation removal',
    blurb: 'Rubbish, glass, dead animals, overgrown vegetation.',
    faults: [
      { id: 'rubbish', label: 'General rubbish on the road, footpath or access path' },
      { id: 'broken-glass', label: 'Broken glass or bottles' },
      { id: 'dead-animal', label: 'Dead animal' },
      { id: 'biohazard', label: 'Biohazardous material (e.g. vomit, blood)' },
      { id: 'vegetation', label: 'Clear weeds, plant growth or vegetation' },
      { id: 'moss', label: 'Moss or lichen on the footpath or road cleared' },
    ],
  },
  {
    id: 'street-lights',
    label: 'Street lights',
    blurb: 'Outages and faults.',
    faults: [
      { id: 'light-single', label: 'Single street light out' },
      { id: 'light-group', label: 'Entire suburb or CBD street out' },
      { id: 'light-other', label: 'General street light enquiry' },
    ],
  },
  {
    id: 'street-furniture',
    label: 'Street furniture',
    blurb: 'Bus stops, hydrants, toilets, ramps.',
    faults: [
      { id: 'bus-stop', label: 'Bus stop' },
      { id: 'fire-hydrant', label: 'Fire hydrant' },
      { id: 'public-toilet', label: 'Public toilet' },
      { id: 'pedestrian-ramp', label: 'Pedestrian ramp' },
      { id: 'other-council-property', label: 'Other Council property' },
    ],
  },
  {
    id: 'traffic-signs',
    label: 'Traffic signs',
    blurb: 'Damaged, missing or obscured signage.',
    faults: [
      { id: 'stop-give-way', label: 'Stop or Give Way sign' },
      { id: 'street-name-sign', label: 'Street name sign' },
      { id: 'parking-sign', label: 'Parking sign (e.g. coupon parking, P60 sign)' },
      { id: 'electronic-sign', label: 'Electronic sign (e.g. digital traffic sign)' },
      { id: 'temporary-roadworks-sign', label: 'Temporary roadworks sign' },
      { id: 'other-traffic-sign', label: 'Other traffic sign' },
    ],
  },
  {
    id: 'parking',
    label: 'Parking',
    blurb: 'Inconsiderate parking and abandoned vehicles.',
    faults: [
      { id: 'abandoned-vehicle', label: 'Abandoned and derelict vehicles' },
      { id: 'blocking-footpath', label: 'Blocking footpath' },
      { id: 'blocking-entrance', label: 'Blocking vehicle entrance' },
      { id: 'overstaying', label: 'Overstaying time restriction' },
      { id: 'mobility-space', label: 'Mobility space' },
      { id: 'other-parking', label: 'Other inconsiderate parking' },
    ],
  },
  {
    id: 'graffiti',
    label: 'Graffiti or vandalism',
    blurb: 'Graffiti on Council property and eligible private property.',
    faults: [
      { id: 'graffiti-council', label: 'Graffiti on Council property' },
      { id: 'graffiti-private', label: 'Graffiti on private property' },
      { id: 'graffiti-enquiry', label: 'General graffiti enquiry' },
    ],
  },
]

// Fault types where the honest answer is "phone, do not fill in a form". The
// existing tool does this too; we keep it, because a prototype that quietly
// absorbs a life-safety report would be worse than no prototype.
export const CALL_111: ReadonlySet<string> = new Set(['assistance', 'building-damage'])
export const CALL_CONTACT_CENTRE: ReadonlySet<string> = new Set([
  'biohazard',
  'water-out',
  'power-out',
])

export const CONTACT_CENTRE = '04 499 4444'

export function serviceById(id: string | null | undefined): Service | null {
  return SERVICES.find((s) => s.id === id) || null
}

export function faultLabel(serviceId: string, faultId: string): string {
  const service = serviceById(serviceId)
  if (!service) return faultId
  const fault = service.faults.find((f) => f.id === faultId)
  return fault ? fault.label : faultId
}

export function isEmergencyService(id: string): boolean {
  return id === EMERGENCY
}
