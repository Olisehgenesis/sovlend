"use client";

import { Camera, LoaderCircle, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { BrandActionButton } from "@/components/ui/brand-action-button";

type ProfilePhoto = { id: string; name: string; isPrimary: boolean };

export function ClientProfilePhotos({ clientId, canManage, photos }: { clientId: string; canManage: boolean; photos: ProfilePhoto[] }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [pending, setPending] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [shots, setShots] = useState<{ url: string; file: File }[]>([]);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOn(false);
  }

  const shotsRef = useRef(shots);
  shotsRef.current = shots;
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    shotsRef.current.forEach((shot) => URL.revokeObjectURL(shot.url));
  }, []);

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) { toast.error("This browser cannot use the camera. Upload photos instead."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      streamRef.current = stream;
      setCameraOn(true);
      requestAnimationFrame(() => {
        if (videoRef.current) { videoRef.current.srcObject = stream; void videoRef.current.play(); }
      });
    } catch {
      toast.error("Camera permission was blocked. Upload photos instead.");
    }
  }

  function takePhoto() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) { toast.error("The camera is not ready yet"); return; }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) { toast.error("Could not capture that photo"); return; }
      const file = new File([blob], `profile-photo-${shots.length + 1}.jpg`, { type: "image/jpeg" });
      setShots((current) => [...current, { url: URL.createObjectURL(file), file }]);
    }, "image/jpeg", 0.9);
  }

  async function upload(files: File[], setPrimary: boolean) {
    if (files.length === 0) { toast.error("Choose or take at least one photo"); return; }
    const body = new FormData();
    files.forEach((file) => body.append("files", file));
    if (setPrimary) body.set("setPrimary", "on");
    setPending(true);
    const response = await fetch(`/api/clients/${clientId}/photos`, { method: "POST", body });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) { toast.error(result.error ?? "Could not save these profile photos"); return; }
    toast.success(files.length === 1 ? "Profile photo saved" : `${files.length} profile photos saved`);
    shots.forEach((shot) => URL.revokeObjectURL(shot.url));
    setShots([]);
    stopCamera();
    router.refresh();
  }

  async function choosePrimary(documentId: string) {
    setPending(true);
    const response = await fetch(`/api/clients/${clientId}/photos/${documentId}`, { method: "POST" });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) { toast.error(result.error ?? "Could not set this profile photo"); return; }
    toast.success("Profile picture updated");
    router.refresh();
  }

  async function remove(documentId: string) {
    if (!window.confirm("Remove this profile photo?")) return;
    setPending(true);
    const response = await fetch(`/api/clients/${clientId}/photos/${documentId}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) { toast.error(result.error ?? "Could not remove this profile photo"); return; }
    toast.success("Profile photo removed");
    router.refresh();
  }

  return (
    <section className="panel profile-photos" id="profile-photos">
      <div className="panel-heading">
        <div>
          <h2>Profile photos</h2>
          <p>Add more than one. The photo marked “On profile” is the picture shown on this client.</p>
        </div>
      </div>
      {photos.length === 0 ? <p className="muted-text">No profile photo yet. iLend portraits were not imported, so add them here.</p> : (
        <div className="profile-photo-row">
          {photos.map((photo) => (
            <article className="profile-photo-card" key={photo.id}>
              <img alt={photo.name} src={`/api/documents/${photo.id}`} />
              <strong>{photo.isPrimary ? "On profile" : photo.name}</strong>
              {canManage ? (
                <div className="profile-photo-actions">
                  {photo.isPrimary ? null : <button disabled={pending} onClick={() => choosePrimary(photo.id)} type="button">Use this</button>}
                  <button className="danger" disabled={pending} onClick={() => remove(photo.id)} type="button"><Trash2 size={12} /> Remove</button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
      {canManage ? (
        <form action={(formData) => {
          const selected = formData.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
          void upload(selected, formData.get("setPrimary") === "on");
        }} className="entity-form compact-mapping">
          <div className="form-row">
            <label>Upload photos<input accept="image/*" multiple name="files" type="file" /></label>
            <label className="check-row"><input defaultChecked name="setPrimary" type="checkbox" /> Use the first photo as the profile picture</label>
          </div>
          <div className="form-actions">
            <BrandActionButton disabled={pending} icon={pending ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />} type="submit">Save photos</BrandActionButton>
            <button className="secondary-action" disabled={pending} onClick={() => (cameraOn ? stopCamera() : void startCamera())} type="button">
              <Camera size={16} /> {cameraOn ? "Close camera" : "Take photos"}
            </button>
          </div>
        </form>
      ) : null}
      {cameraOn ? (
        <div className="profile-camera">
          <video autoPlay muted playsInline ref={videoRef} />
          <div className="form-actions">
            <button className="secondary-action" disabled={pending} onClick={takePhoto} type="button">Take photo</button>
            <BrandActionButton disabled={pending || shots.length === 0} onClick={() => void upload(shots.map((shot) => shot.file), !photos.some((photo) => photo.isPrimary))} type="button">
              Save {shots.length || ""} captured {shots.length === 1 ? "photo" : "photos"}
            </BrandActionButton>
          </div>
          {shots.length > 0 ? (
            <div className="profile-photo-row">
              {shots.map((shot) => <img alt="Captured profile" key={shot.url} src={shot.url} />)}
            </div>
          ) : <p className="muted-text">Take one photo, then take another. Save stores every shot together.</p>}
        </div>
      ) : null}
    </section>
  );
}
