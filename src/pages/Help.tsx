import {
  LayoutDashboard,
  Users,
  Search,
  Upload,
  Camera,
  Settings,
  Activity,
  Trash2,
  Recycle,
  ShieldCheck,
  Sparkles,
  UserCog,
  Database,
} from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import type { PageProps } from '@/types'

interface HelpSection {
  icon: typeof LayoutDashboard
  title: string
  body: string
  steps?: string[]
}

function Section({ icon: Icon, title, body, steps }: HelpSection) {
  return (
    <section className="surface-card rounded-lg p-5">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#eaf0f7] text-[#315c87]">
          <Icon size={18} />
        </div>
        <h2 className="text-sm font-bold text-[#1c2f47]">{title}</h2>
      </div>
      <p className="text-xs leading-relaxed text-[#617084]">{body}</p>
      {steps && steps.length > 0 && (
        <ol className="mt-3 space-y-2">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-2.5 text-xs text-[#47576b]">
              <span className="mono flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#24558d] text-[10px] font-bold text-white">
                {i + 1}
              </span>
              <span className="leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function Help({ user }: PageProps) {
  const isAdmin = user.role === 'admin'

  return (
    <div className="mx-auto max-w-[1000px] p-5 sm:p-7">
      <PageHeader
        eyebrow="Guides"
        title="Help & Documentation"
        description={isAdmin 
          ? "A quick reference for every part of the AdZU Registrar Document Archiving System."
          : "A guide to searching, viewing, and printing archived documents."}
      />

      <div className="mb-5 rounded-md border border-[#dce6f2] bg-[#f4f8fc] px-4 py-3">
        <div className="flex items-start gap-2">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[#24558d]" />
          <p className="text-xs leading-relaxed text-[#34445a]">
            You are signed in as <strong>{user.username}</strong> ({isAdmin ? 'Administrator' : 'Regular Staff'}).
            {isAdmin && ' This guide covers all administrative features including uploading documents, managing users, and the recycle bin.'}
            {!isAdmin && ' As Regular Staff, you can browse students, search documents, view archived files, and print documents.'}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Section
          icon={LayoutDashboard}
          title="Dashboard"
          body={isAdmin 
            ? "Your landing page after signing in. Three cards summarise the archive — student records, total documents and recent uploads — and the Recent Documents table underneath lists the ten most recently filed documents."
            : "Your landing page showing archive statistics — total student records and indexed documents available for search and retrieval."}
          steps={isAdmin ? [
            'Review the three statistics cards for the current state of the archive.',
            'Click any row in Recent Documents to open that document in the viewer, the same way you do from Search or the student record.',
            'In the viewer you can preview the file, Print it, Export a copy, or open it with Open Externally in the default application for that file type.',
          ] : undefined}
        />

        <Section
          icon={Users}
          title="Student Records"
          body="The directory of every student in the archive. Search, sort, and open a student to browse their documents."
          steps={[
            'Type in the search bar — matching students are suggested live as you type (2+ characters).',
            'Narrow results with the School Year and Program Level dropdowns beside the search bar.',
            "Click any row to open that student's document folders, grouped by document type.",
            ...(isAdmin ? ['Administrators can add, edit, or delete students from the Actions column.'] : [])
          ]}
        />

        <Section
          icon={Search}
          title="Search Documents"
          body="Find archived documents across all students. Filter by student name, document type, or academic year, then sort and page through the results."
          steps={[
            'Use the search and filter controls to narrow results.',
            'Click any document row to view its details.',
            ...(isAdmin ? ['Administrators can view, print, export, edit, or delete documents.'] : ['Click the Print icon to print a document to your connected printer.'])
          ]}
        />

        {isAdmin && (
          <Section
            icon={Trash2}
            title="Deleting a Student"
            body="Deleting a student moves the record to the Recycle Bin instead of erasing it, so an accidental deletion can always be recovered."
            steps={[
              "Choose Delete from a student's Actions column (Administrators only).",
              'The record is soft-deleted and disappears from the main directory.',
              'Open the Recycle Bin to Restore it, or Delete Permanently once you are certain.',
            ]}
          />
        )}

        {isAdmin && (
          <Section
            icon={Recycle}
            title="Student Recycle Bin"
            body="Holds every soft-deleted student. Restore a record to return it to the active directory, or permanently remove it. A student with archived documents cannot be permanently deleted until those documents are removed first."
          />
        )}

        {isAdmin && (
          <Section
            icon={Trash2}
            title="Document Recycle Bin"
            body="Deleted documents are moved to the Document Recycle Bin instead of being permanently removed, allowing you to recover from accidental deletions."
            steps={[
              'Access the Document Recycle Bin from the Search Documents page (Administrators only).',
              'View all soft-deleted documents with their student associations and deletion timestamps.',
              'Click Restore to return a document to the active archive.',
              'Click Delete Forever to permanently purge a document — this removes both the database record and the physical file.',
            ]}
          />
        )}

        {isAdmin && (
          <Section
            icon={Upload}
            title="Upload Documents"
            body="Import documents from disk or scan them with a camera, tag each with a student, document type, and academic year, then archive them. Files enter the intake queue exactly as they are — nothing is cropped or resized, and the Image Editor never opens by itself."
            steps={[
              'Pick a workflow — Single Student Import or Mixed-Batch Import — then choose the Upload card or the Capture card.',
              'For uploads, Select Files to Upload and pick one or more image/PDF/Office files. Each one joins the queue whole, at its original resolution.',
              'Use Edit on a queued image only when you want it straightened; the editor opens the untouched file. Edit All Images walks the queue one image at a time.',
              'Fill in the details for each document, then submit to archive the batch.',
            ]}
          />
        )}

        {isAdmin && (
          <Section
            icon={Camera}
            title="Camera Scanning"
            body="The scanner keeps the live feed running so you can digitise a stack of pages without restarting anything. Captures are taken at the camera's full native resolution, in the frame as you positioned them."
            steps={[
              'Use the Camera and Resolution dropdowns to pick your device. If a camera is busy or unavailable, a warning appears but the controls stay usable — just choose another camera.',
              'Auto-Crop Scan On traces the page edges in the preview so you can see how the document is being read; Off shows a plain feed. Either way the camera never crops the capture for you.',
              'Press Capture Document. The frame joins the queue and the preview stays live, so you can turn the page and capture again straight away.',
              'Preview, Retake or Edit any capture in the list below the viewfinder while the camera keeps running.',
              'Press Finish Scanning when the stack is done — this releases the camera and moves on to tagging and archiving. Cancel releases it too, and so does leaving the screen entirely.',
            ]}
          />
        )}

        {isAdmin && (
          <Section
            icon={Sparkles}
            title="The Image Editor"
            body="Opens only when you ask for it — Edit on one queued document, or Edit All Images to step through the batch. Every image arrives untouched; detection and cropping are never run automatically."
            steps={[
              'Auto-Crop runs edge detection on the image and drops adjustable corners on the page it finds — drag them onto the document and press Apply Corners.',
              'Adjust Corners does the same without running detection first, so you can place the corners by hand on a page the detector missed.',
              'Manual Crop draws a plain rectangle, and Rotate Left/Right and the Zoom slider square up the view.',
              'Reset All returns to the original capture — it is kept until you press Save Changes, which is what archives the edited image.',
            ]}
          />
        )}

        {isAdmin && (
          <Section
            icon={UserCog}
            title="User Accounts"
            body="Settings → Users lists every account with its role and status, and is administrator-only. Deactivating parks an account; deleting removes it for good."
            steps={[
              'Deactivate / Activate switches an account off without removing it. A deactivated user cannot sign in.',
              'Delete asks for confirmation and then erases the account from the database — there is no restore and no recycle bin for user accounts.',
              'Deleting an account does not erase its name from history: every document stores the username of whoever archived it, so the Archived By credit and the viewer detail stay intact after the account is gone.',
              'Two safety rails stay in place — you cannot delete your own account, and the last remaining active administrator cannot be deleted.',
              'To remove an administrator, first create or activate another active admin, sign in as that account, then delete the one you want gone.',
            ]}
          />
        )}

        {isAdmin && (
          <Section
            icon={Database}
            title="Backup & System Purge"
            body="Settings → Backup stores a portable copy of the archive, restores it, and holds the maintenance controls. Create a backup before purging — a purge cannot be undone."
            steps={[
              'Purge Entire Archive opens a dialog that requires your own administrator password; the backend re-checks that password before it deletes anything.',
              'Entering it opens a final warning, which you must confirm a second time before the wipe runs.',
              'The purge permanently deletes every student record, archived document record and physical file, and clears the activity log as well.',
              'When it finishes it reports how much was removed and writes one fresh log entry recording who purged the archive.',
            ]}
          />
        )}

        {isAdmin && (
          <Section
            icon={Settings}
            title="Settings"
            body="Four tabs run the system: General for the archive folder and system configuration, Users for account management, Document Types for the list offered when tagging a document, and Backup for backup, restore and the purge."
          />
        )}

        {isAdmin && (
          <Section
            icon={Activity}
            title="Activity Log"
            body="An audit trail of actions taken in the system — logins, student and document changes, and deletions — with the responsible user and timestamp."
          />
        )}
      </div>

      <section className="surface-card mt-4 rounded-lg p-5">
        <h2 className="mb-2 text-sm font-bold text-[#1c2f47]">Tips</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-[#617084]">
          <li>Search suggestions appear after typing at least two characters; selecting one runs the search immediately.</li>
          {isAdmin && <li>Edge detection reads the page shape, not just its brightness, so light desks, dark mats and wood grain all work — keep the whole page inside the frame and avoid a shadow crossing an edge.</li>}
          {isAdmin && <li>Nothing is cropped on its own. Auto-Crop only runs when you press it in the Image Editor, and it never deletes anything — the original capture is kept until you accept an edit.</li>}
          {isAdmin && <li>The camera stays open for a whole stack. Reposition the page and capture again instead of restarting the scan; it is released when you finish or leave the step.</li>}
          {isAdmin && <li>Only image files (JPG, PNG, GIF) can be cropped or rotated; PDFs and Office files are archived as-is.</li>}
          {isAdmin && <li>Archived documents always remember the username of whoever filed them, so deleting an account never rewrites that history.</li>}
          {!isAdmin && <li>If you need to edit or delete a document, contact an Administrator for assistance.</li>}
          {!isAdmin && <li>Document search results can be filtered by student name, document type, and academic year.</li>}
        </ul>
      </section>
    </div>
  )
}

export default Help
