"use client";

import { useEffect, useState } from "react";
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
import {
  createExperienceAction,
  updateExperienceAction,
} from "@/lib/actions/experiences";
import type { Category, Experience } from "@/lib/types";

interface ExperienceDialogProps {
  tripId: string;
  destinationId: string;
  categories: Category[];
  experience: Experience | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function ExperienceDialog({
  tripId,
  destinationId,
  categories,
  experience,
  open,
  onOpenChange,
  onSaved,
}: ExperienceDialogProps) {
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [rating, setRating] = useState(0);
  const [visitedDate, setVisitedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset the form to the editing target (or blank) each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setName(experience?.name ?? "");
    setCategoryId(experience?.category_id ?? "");
    setRating(experience?.rating ?? 0);
    setVisitedDate(experience?.visited_date ?? "");
    setNotes(experience?.notes ?? "");
  }, [open, experience]);

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
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {experience ? "Edit experience" : "Add experience"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
                    <CategoryIcon
                      icon={category.icon}
                      className="size-4"
                    />
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
              onClick={() => onOpenChange(false)}
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
      </DialogContent>
    </Dialog>
  );
}
