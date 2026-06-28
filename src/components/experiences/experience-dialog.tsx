"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RatingInput } from "@/components/rating-input";
import { CategoryIcon } from "@/components/category-icon";
import { PoiSearch } from "@/components/poi-search";
import {
  createExperienceAction,
  updateExperienceAction,
} from "@/lib/actions/experiences";
import type { Category, Experience, PoiResult } from "@/lib/types";

interface ExperienceDialogProps {
  tripId: string;
  destinationId: string;
  categories: Category[];
  experience: Experience | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  // The destination center, used to bias POI search results.
  destLat?: number | null;
  destLng?: number | null;
}

// The dialog owns the open state; the form lives in a child so it mounts fresh
// (and resets from the current experience) each time the dialog opens, with no
// reset effect.
export function ExperienceDialog({
  tripId,
  destinationId,
  categories,
  experience,
  open,
  onOpenChange,
  onSaved,
  destLat = null,
  destLng = null,
}: ExperienceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {experience ? "Edit experience" : "Add experience"}
          </DialogTitle>
        </DialogHeader>
        <ExperienceForm
          tripId={tripId}
          destinationId={destinationId}
          categories={categories}
          experience={experience}
          destLat={destLat}
          destLng={destLng}
          onCancel={() => onOpenChange(false)}
          onSaved={() => {
            onOpenChange(false);
            onSaved();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function ExperienceForm({
  tripId,
  destinationId,
  categories,
  experience,
  destLat,
  destLng,
  onCancel,
  onSaved,
}: {
  tripId: string;
  destinationId: string;
  categories: Category[];
  experience: Experience | null;
  destLat: number | null;
  destLng: number | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(experience?.name ?? "");
  const [categoryId, setCategoryId] = useState<string>(
    experience?.category_id ?? "",
  );
  const [rating, setRating] = useState(experience?.rating ?? 0);
  const [visitedDate, setVisitedDate] = useState(
    experience?.visited_date ?? "",
  );
  const [notes, setNotes] = useState(experience?.notes ?? "");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);

  function handlePoiSelect(poi: PoiResult) {
    setName(poi.name);
    setCoords({ lat: poi.lat, lng: poi.lng });
    // Auto-select the matching category if its slug exists in the list.
    const match = categories.find(
      (category) => category.slug === poi.category_slug,
    );
    if (match) setCategoryId(match.id);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      toast.error("Experience name is required.");
      return;
    }
    setSubmitting(true);
    const input = {
      name: name.trim(),
      category_id: categoryId || null,
      rating: rating > 0 ? rating : null,
      visited_date: visitedDate || null,
      notes: notes.trim() || null,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
    };
    const result = experience
      ? await updateExperienceAction(
          tripId,
          destinationId,
          experience.id,
          input,
        )
      : await createExperienceAction(tripId, destinationId, input);

    setSubmitting(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor="exp-poi">Search for a place (optional)</Label>
        <PoiSearch
          id="exp-poi"
          lat={destLat}
          lng={destLng}
          onSelect={handlePoiSelect}
        />
        <p className="text-xs text-muted-foreground">
          Pick a place to fill the name and category, or just type it below.
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="exp-name">Name</Label>
        <Input
          id="exp-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="British Museum"
          required
          disabled={submitting}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="exp-category">Category</Label>
        <Select
          value={categoryId}
          onValueChange={setCategoryId}
          disabled={submitting}
        >
          <SelectTrigger id="exp-category">
            <SelectValue placeholder="Select a category" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                <CategoryIcon icon={category.icon} className="size-4" />
                {category.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label>Rating</Label>
        <div className="flex items-center gap-3">
          <RatingInput value={rating} onChange={setRating} size={26} />
          {rating > 0 ? (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setRating(0)}
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="exp-date">Visited date</Label>
        <Input
          id="exp-date"
          type="date"
          value={visitedDate}
          onChange={(e) => setVisitedDate(e.target.value)}
          disabled={submitting}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="exp-notes">Notes</Label>
        <Textarea
          id="exp-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={submitting}
        />
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          disabled={submitting}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={submitting}
          className="bg-brand text-brand-foreground hover:bg-brand/90"
        >
          {submitting ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : experience ? (
            "Save"
          ) : (
            "Add experience"
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}
